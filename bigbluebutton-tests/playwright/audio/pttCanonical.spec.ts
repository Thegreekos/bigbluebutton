import { expect } from '@playwright/test';

import { ensurePublicChatOpen } from '../chat/util';
import { elements as e } from '../core/elements';
import { apiCall } from '../core/helpers';
import { isLiveKit } from '../core/livekit';
import { parameters } from '../core/parameters';
import { test } from '../core/setup/fixtures';
import { Audio } from './audio';
import { exposeLiveKitRoom, getLocalMicState, getRemoteAudioStates, type TestWindow } from './liveKitProbe';
import { connectMicrophone } from './util';

const COOLDOWN_MS = 800;
const SETTLE_MS = 450;
type Scenario = 'normal' | 'focus' | 'Control' | 'Alt' | 'blur' | 'visibility';

// A media-level counter from the actual LiveKit publisher RTCPeerConnection.
// In particular, a *missing* publication is not interpreted as a test failure
// in the muted state: unpublishOnMute may legitimately remove it.
async function readOutbound(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const room = (window as TestWindow).liveKitRoom;
    if (!room) throw new Error('test LiveKit room not exposed');
    const engine = room as unknown as {
      engine?: { pcManager?: { publisher?: { pc?: RTCPeerConnection } } };
    };
    const pc = engine.engine?.pcManager?.publisher?.pc;
    if (!pc) throw new Error('LiveKit publisher peer connection unavailable');
    const stats = await pc.getStats();
    let packets = 0;
    let bytes = 0;
    let streams = 0;
    stats.forEach((report) => {
      if (report.type === 'outbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
        packets += report.packetsSent ?? 0;
        bytes += report.bytesSent ?? 0;
        streams += 1;
      }
    });
    return { packets, bytes, streams };
  });
}

// The release bundle does not expose Apollo devtools even when a meeting
// requests it. Ask BBB's normal, cookie-authenticated GraphQL middleware for
// read-only, meeting-scoped voice rows over graphql-transport-ws instead.
async function readServerVoice(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    type Voice = { userId: string; muted: boolean; talking: boolean };
    return new Promise<Voice>((resolve, reject) => {
      const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/graphql`, 'graphql-transport-ws');
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('voice query timed out'));
      }, 7000);
      const finish = (value?: Voice, error?: string) => {
        clearTimeout(timer);
        socket.close();
        if (value) resolve(value);
        else reject(new Error(error || 'voice query empty'));
      };
      socket.onopen = () => {
        const sessionToken = sessionStorage.getItem('sessionToken');
        const clientSessionUUID = sessionStorage.getItem('clientSessionUUID');
        if (!sessionToken || !clientSessionUUID) {
          finish(undefined, 'missing browser session identity');
          return;
        }
        socket.send(
          JSON.stringify({
            type: 'connection_init',
            payload: {
              headers: {
                'X-Session-Token': sessionToken,
                'X-ClientSessionUUID': clientSessionUUID,
                'X-ClientType': 'HTML5',
                'X-ClientIsMobile': 'false',
              },
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'connection_ack') {
          socket.send(
            JSON.stringify({
              id: 'voice',
              type: 'subscribe',
              payload: { query: 'query PttVoiceProbe { user_current { userId } user_voice { userId muted talking } }' },
            }),
          );
        } else if (msg.type === 'next') {
          const { data } = msg.payload || {};
          const id = data?.user_current?.[0]?.userId;
          const voice = data?.user_voice?.find((row: { userId: string }) => row.userId === id);
          if (voice) finish({ userId: id, muted: voice.muted, talking: voice.talking });
          else finish(undefined, `voice row missing; errors=${JSON.stringify(msg.payload?.errors ?? [])}`);
        } else if (msg.type === 'error') finish(undefined, JSON.stringify(msg.payload));
      };
      socket.onerror = () => finish(undefined, 'GraphQL websocket error');
      socket.onclose = (event) => {
        if (event.code !== 1000) finish(undefined, `GraphQL closed (${event.code}): ${event.reason}`);
      };
    });
  });
}

(['normal', 'focus', 'Control', 'Alt', 'blur', 'visibility'] as const).forEach((scenario: Scenario) => {
  test(`Canonical PTT RC4 ${scenario}: server voice and RTP`, async ({ browser }, testInfo) => {
    test.skip(!isLiveKit, 'RTP oracle requires LiveKit');
    test.setTimeout(150_000);
    const context = await browser.newContext();
    const audio = new Audio(browser, context);
    const modRaw = await context.newPage();
    await modRaw.addInitScript(() => {
      const w = window as Window & { pttCanonicalEvents?: object[] };
      w.pttCanonicalEvents = [];
      for (const type of ['keydown', 'keyup']) {
        document.addEventListener(
          type,
          (event) => {
            const key = event as KeyboardEvent;
            if (key.key.toLowerCase() === 'm' || key.key === 'Control' || key.key === 'Alt') {
              w.pttCanonicalEvents?.push({
                type,
                key: key.key,
                ctrl: key.ctrlKey,
                alt: key.altKey,
                focus: (document.activeElement as HTMLElement)?.tagName,
              });
            }
          },
          true,
        );
      }
      window.addEventListener('blur', () => w.pttCanonicalEvents?.push({ type: 'blur' }), true);
    });
    await exposeLiveKitRoom(modRaw);
    await audio.initModPage(modRaw, { testInfo });
    const { modPage } = audio;
    await context.addInitScript(() => {
      (window as TestWindow).BBB_EXPOSE_LIVEKIT_ROOM = true;
    });
    await audio.initUserPage(context, { testInfo });
    await modPage.waitAndClick(e.joinAudio);
    await connectMicrophone(modPage);
    await audio.userPage.waitAndClick(e.joinAudio);
    await connectMicrophone(audio.userPage);
    await ensurePublicChatOpen(modPage);

    const readState = async () => {
      const row = await readServerVoice(modRaw);
      return {
        voice: { muted: row.muted, talking: row.talking },
        outbound: await readOutbound(modRaw),
        local: await getLocalMicState(modRaw),
        remote: await getRemoteAudioStates(audio.userPage.page),
      };
    };
    const snapshots: Array<{ step: string; state: Awaited<ReturnType<typeof readState>> }> = [];
    const capture = async (step: string) => {
      const state = await readState();
      snapshots.push({ step, state });
      console.log(scenario, step, JSON.stringify(state));
      return state;
    };
    const expectVoice = async (muted: boolean) => {
      await expect(async () => {
        const { voice } = await readState();
        expect(voice.muted).toBe(muted);
        if (muted) expect(voice.talking).toBe(false);
      }).toPass({ timeout: 12_000 });
    };
    const expectRtpGrowth = async () => {
      const before = await readOutbound(modRaw);
      await expect(async () => {
        const after = await readOutbound(modRaw);
        expect(after.packets, 'outbound audio RTP packets must increase').toBeGreaterThan(before.packets);
        expect(after.bytes, 'outbound audio RTP bytes must increase').toBeGreaterThan(before.bytes);
      }).toPass({ timeout: 7_000 });
    };
    const expectSilence = async () => {
      await modRaw.waitForTimeout(SETTLE_MS);
      const before = await readOutbound(modRaw);
      await modRaw.waitForTimeout(1100);
      const after = await readOutbound(modRaw);
      // LiveKit's muted sender can emit silence/comfort RTP, and the tail of
      // an encoded frame can straddle the mute transition. Record actual rate,
      // but use server voice and remote muted publication as the release oracle.
      const deltaPackets = after.packets - before.packets;
      const deltaBytes = after.bytes - before.bytes;
      console.log(
        scenario,
        'post-release RTP',
        JSON.stringify({
          deltaPackets,
          deltaBytes,
          bytesPerPacket: deltaPackets > 0 ? deltaBytes / deltaPackets : 0,
        }),
      );
      await capture('post-release-settled');
      await expectVoice(true);
      const remote = await getRemoteAudioStates(audio.userPage.page);
      expect(
        remote.every((state) => state.unmuted === 0),
        'remote mic must be signalled muted',
      ).toBe(true);
    };
    const focusBody = () => modRaw.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const press = async (label: string) => {
      await focusBody();
      await modRaw.keyboard.down('m');
      await expectVoice(false);
      await expectRtpGrowth();
      await capture(label);
    };
    const release = async (label: string) => {
      await modRaw.keyboard.up('m');
      await capture(label);
      await expectSilence();
    };
    try {
      await expectVoice(true);
      await capture('initial-muted');
      await press('first-down');
      if (scenario === 'focus') await modRaw.locator(e.chatBox).focus();
      if (scenario === 'Control' || scenario === 'Alt') await modRaw.keyboard.down(scenario);
      if (scenario === 'blur') await modRaw.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (scenario === 'visibility') {
        await modRaw.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      if (scenario === 'blur' || scenario === 'visibility') {
        await capture('focus-loss-before-keyup');
        await expectVoice(true);
        const beforeKeyup = await getRemoteAudioStates(audio.userPage.page);
        expect(
          beforeKeyup.every((state) => state.unmuted === 0),
          'focus loss alone must mute remote audio',
        ).toBe(true);
      }
      await release('first-up');
      if (scenario === 'visibility') {
        await modRaw.evaluate(() => {
          Reflect.deleteProperty(document, 'visibilityState');
        });
      }
      if (scenario === 'Control' || scenario === 'Alt') await modRaw.keyboard.up(scenario);
      await modRaw.waitForTimeout(COOLDOWN_MS + 200);
      await press('second-down-after-cooldown');
      await release('second-up');
    } finally {
      await testInfo.attach(`ptt-${scenario}-oracles.json`, {
        body: JSON.stringify(snapshots, null, 2),
        contentType: 'application/json',
      });
      const eventTrace = await modRaw
        .evaluate(() => (window as Window & { pttCanonicalEvents?: object[] }).pttCanonicalEvents ?? [])
        .catch(() => []);
      console.log(scenario, 'keyboard events:', JSON.stringify(eventTrace));
      await testInfo.attach(`ptt-${scenario}-events.json`, {
        body: JSON.stringify(eventTrace, null, 2),
        contentType: 'application/json',
      });
      await modRaw.keyboard.up('m').catch(() => {});
      await apiCall('end', { meetingID: modPage.meetingId, password: parameters.moderatorPW }).catch(() => {});
      await context.close();
    }
  });
});
