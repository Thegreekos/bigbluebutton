import { initializePages } from '../core/helpers';
import { isLiveKit } from '../core/livekit';
import { test } from '../core/setup/fixtures';
import { Audio } from './audio';

test.describe.parallel('Audio', { tag: ['@ci', '@media'] }, () => {
  let audio: Audio;

  test.beforeEach(async ({ browser, context }, testInfo) => {
    audio = new Audio(browser, context);
    if (testInfo.title.startsWith('Push-to-talk')) {
      // initializePages creates a separate browser context. Opt in on the
      // actual context that owns both meeting tabs, before either is opened.
      const audioContext = await browser.newContext();
      await audioContext.addInitScript(() => {
        (window as typeof window & { BBB_EXPOSE_LIVEKIT_ROOM?: boolean }).BBB_EXPOSE_LIVEKIT_ROOM = true;
      });
      audio = new Audio(browser, audioContext);
      const modPage = await audioContext.newPage();
      await audio.initModPage(modPage, { testInfo });
      await audio.initUserPage(audioContext, { testInfo });
      return;
    }
    await initializePages(audio, browser, { isMultiUser: true, testInfo });
  });

  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#listen-only-mode-automated
  test('Join audio with Listen Only', async () => {
    test.skip(isLiveKit, 'LiveKit does not have a dedicated listen-only mode');
    await audio.joinAudio();
  });

  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#join-audio-automated
  test('Join audio with Microphone', async () => {
    await audio.joinMicrophone();
  });

  test('Change audio input and keep it connected', async ({ browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox does not support fake audio to simulate de audio.');
    await audio.changeAudioInput();
  });

  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#muteunmute
  test('Mute yourself by clicking the mute button', async () => {
    await audio.muteYourselfByButton();
  });

  (['normal', 'focus', 'Control', 'Alt', 'blur', 'visibility'] as const).forEach((scenario) => {
    test(`Push-to-talk release ${scenario} mutes publication and permits next cycle`, async () => {
      await audio.pushToTalkReleaseAfterFocusChange(scenario);
    });
  });

  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#choosing-different-sources
  test('Keep the last mute state after rejoining audio', async () => {
    await audio.keepMuteStateOnRejoin();
  });

  // Talking Indicator
  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#talking-indicator
  test('Mute yourself by clicking the talking indicator', async () => {
    await audio.muteYourselfByTalkingIndicator();
  });

  // https://docs.bigbluebutton.org/3.0/testing/release-testing/#talking-indicator
  test('Mute another user by clicking the talking indicator', async () => {
    await audio.muteAnotherUser();
  });
});
