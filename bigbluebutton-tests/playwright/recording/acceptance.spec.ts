import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';

import { connectMicrophone } from '../audio/util';
import { ensurePublicChatOpen } from '../chat/util';
import { ELEMENT_WAIT_LONGER_TIME } from '../core/constants';
import { elements as e, playbackElements } from '../core/elements';
import { apiCall } from '../core/helpers';
import { parameters } from '../core/parameters';
import { test } from '../core/setup/fixtures';
import { uploadSinglePresentation } from '../presentation/util';
import { startScreenshare } from '../screenshare/util';
import { Recording } from './recording';

test('dedicated recorded meeting publishes playable audio, webcam, slides, screen and chat', async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.setTimeout(18 * 60 * 1000); // archive/process/publish are asynchronous, never skip a phase to pass
  const recording = new Recording(browser, context);
  await recording.initModPage(page, { createParameter: 'record=true', shouldCloseAudioModal: false, testInfo });
  await recording.initUserPage(context, { testInfo });
  const mod = recording.modPage;
  const viewer = recording.userPage;
  const marker = `recording-acceptance-${Date.now()}`;
  try {
    await connectMicrophone(mod);
    await mod.waitAndClick(e.unmuteMicButton);
    await mod.hasElement(e.isTalking, 'fake microphone must be transmitting');
    // Match the green Webcam/Shares webcam case: moderator publishes using
    // Page.shareWebcam and attendee verifies the remote stream. Use the same
    // Chromium launch arguments, media fixtures, and browser permissions.
    await mod.shareWebcam({
      shouldConfirmSharing: !(mod.settings?.skipVideoPreview || mod.settings?.skipVideoPreviewOnFirstJoin),
      videoPreviewTimeout: mod.settings?.videoPreviewTimeout,
    });
    await viewer.hasElement(e.webcamVideoItem, 'attendee must receive moderator webcam', 30_000);
    await viewer.hasElement(e.webcamContainer, 'attendee must have remote webcam video', 30_000);
    await mod.waitForSelector(e.whiteboard, ELEMENT_WAIT_LONGER_TIME);
    await mod.page.locator(e.skipSlide).selectOption({ index: 1 });
    await uploadSinglePresentation(mod, 'mockPollSlide.pdf');
    await mod.waitAndClick(e.recordingIndicator);
    await mod.waitAndClick(e.confirmRecordingButton);
    await ensurePublicChatOpen(mod);
    await mod.fill(e.chatBox, marker);
    await mod.waitAndClick(e.sendButton);
    await expect(mod.page.locator(e.chatUserMessageText).filter({ hasText: marker })).toBeVisible();
    await startScreenshare(mod);
    await viewer.hasElement(e.screenShareVideo, 'viewer must receive recorded screenshare', 20_000);
    await mod.waitAndClick(e.stopScreenSharing);
    await mod.wasRemoved(e.isSharingScreen, 'screenshare must stop');
    await expect(async () => {
      const timer = await mod.page.locator(`${e.recordingIndicator} button`).textContent();
      const match = timer?.match(/(\d+):(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1]) * 60 + Number(match![2])).toBeGreaterThan(8);
    }).toPass({
      timeout: 30_000,
    });
    await mod.waitAndClick(e.leaveMeetingDropdown);
    await mod.waitAndClick(e.endMeetingButton);
    await mod.waitAndClick(e.confirmEndMeetingButton);
    await mod.hasElement(e.meetingEndedModal, 'meeting must end before processing');
    // getRecordings exposes only published output; polling it waits across
    // archive -> process -> publish instead of assuming an immediate recording.
    const { response } = await recording.getRecordingsWithRetry(90, 10_000);
    const item = response.recordings?.[0]?.recording?.[0];
    expect(item, 'API must return a published recording').toBeDefined();
    const formats = item?.playback?.[0]?.format ?? [];
    const presentation = formats.find((format: { type?: string[] }) => format.type?.[0] === 'presentation');
    const playbackUrl = presentation?.url?.[0];
    expect(playbackUrl, 'presentation playback URL must exist').toContain('/playback/presentation/');
    const urlParts = new URL(playbackUrl).pathname.split('/');
    const recordingId = urlParts[urlParts.length - 1];
    expect(recordingId, 'playback ID must be safe to use for local media verification').toMatch(/^[a-f0-9]{40}-\d+$/);
    const statusDir = '/var/bigbluebutton/recording/status';
    for (const [phase, suffix] of [
      ['archived', '.done'],
      ['processed', '-presentation.done'],
      ['published', '-presentation.done'],
    ]) {
      expect(existsSync(path.join(statusDir, phase, `${recordingId}${suffix}`)), `${phase} must finish`).toBe(true);
    }
    const published = path.join('/var/bigbluebutton/published/presentation', recordingId);
    expect(readFileSync(path.join(published, 'slides_new.xml'), 'utf8')).toContain(marker);
    for (const [relative, codecs] of [
      ['video/webcams.webm', ['audio', 'video']],
      ['deskshare/deskshare.webm', ['video']],
    ] as const) {
      const media = path.join(published, relative);
      expect(existsSync(media), `${relative} must be published`).toBe(true);
      const probe = (args: string[]) => execFileSync('ffprobe', ['-v', 'error', ...args, media], { encoding: 'utf8' });
      const duration = Number(probe(['-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1']));
      expect(duration, `${relative} must have real duration`).toBeGreaterThan(2);
      const streams = probe(['-show_entries', 'stream=codec_type', '-of', 'default=nokey=1:noprint_wrappers=1']);
      codecs.forEach((codec) => expect(streams, `${relative} must contain ${codec}`).toContain(codec));
    }
    expect(
      new URL(playbackUrl).hostname,
      'recording playback URL must point to the actual BBB host, not a placeholder',
    ).toBe(new URL(parameters.server!).hostname);
    const start = Number(item?.startTime?.[0]);
    const end = Number(item?.endTime?.[0]);
    expect(end - start, 'recording API duration must be non-zero').toBeGreaterThan(8000);
    const playback = await context.newPage();
    const result = await playback.goto(playbackUrl);
    expect(result?.ok(), 'published playback must be reachable').toBe(true);
    await expect(playback.locator(playbackElements.mediaArea)).toBeVisible();
    await expect(playback.getByText(marker), 'playback must include the known chat content').toBeVisible({
      timeout: 30_000,
    });
  } finally {
    // The BBB API meeting duration is not a cleanup mechanism. If the test
    // fails before the UI end action, the runner should still end only its own meeting.
    if ((await mod.page.locator(e.meetingEndedModal).count()) === 0) {
      // Use the existing signed API helper when UI teardown did not complete.
      await apiCall('end', { meetingID: mod.meetingId, password: 'mp' }).catch(() => {});
    }
  }
});
