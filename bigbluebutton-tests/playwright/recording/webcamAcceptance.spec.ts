import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@playwright/test';

import { elements as e } from '../core/elements';
import { apiCall } from '../core/helpers';
import { test } from '../core/setup/fixtures';
import { Recording } from './recording';

// Run with --repeat-each=3 --workers=1. Each repetition gets a new record=true
// meeting. Page.shareWebcam is exactly the activation used by green Webcam/Shares webcam.
test('dedicated webcam publication survives into published recording', async ({ browser, context, page }, testInfo) => {
  test.setTimeout(12 * 60 * 1000);
  const recording = new Recording(browser, context);
  await recording.initModPage(page, { createParameter: 'record=true', testInfo });
  await recording.initUserPage(context, { testInfo });
  const mod = recording.modPage;
  const viewer = recording.userPage;
  const startedAt = Date.now();
  try {
    await viewer.shareWebcam({
      shouldConfirmSharing: !(viewer.settings?.skipVideoPreview || viewer.settings?.skipVideoPreviewOnFirstJoin),
      videoPreviewTimeout: viewer.settings?.videoPreviewTimeout,
    });
    await expect(mod.page.locator(e.webcamContainer), 'moderator must see attendee webcam video').toBeVisible({
      timeout: 30_000,
    });
    await expect(async () => {
      const video = await mod.page.locator(e.webcamContainer).evaluate((element: HTMLVideoElement) => ({
        width: element.videoWidth,
        ready: element.readyState,
      }));
      expect(video.width).toBeGreaterThan(0);
      expect(video.ready).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 30_000 });
    const remoteVideo = await mod.page.locator(e.webcamContainer).evaluate((video: HTMLVideoElement) => ({
      width: video.videoWidth,
      ready: video.readyState,
    }));
    expect(remoteVideo.width).toBeGreaterThan(0);
    expect(remoteVideo.ready).toBeGreaterThanOrEqual(2);
    console.log(`webcam connection observed after ${Date.now() - startedAt}ms`);

    await mod.waitAndClick(e.recordingIndicator);
    await mod.waitAndClick(e.confirmRecordingButton);
    await expect(async () => {
      const timer = await mod.page.locator(`${e.recordingIndicator} button`).textContent();
      const match = timer?.match(/(\d+):(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1]) * 60 + Number(match![2])).toBeGreaterThan(7);
    }).toPass({ timeout: 30_000 });
    await mod.waitAndClick(e.leaveMeetingDropdown);
    await mod.waitAndClick(e.endMeetingButton);
    await mod.waitAndClick(e.confirmEndMeetingButton);
    await mod.hasElement(e.meetingEndedModal, 'recorded meeting must end');

    const { response } = await recording.getRecordingsWithRetry(90, 10_000);
    const recordingId = response.recordings?.[0]?.recording?.[0]?.recordID?.[0];
    expect(recordingId, 'published recording ID must exist').toMatch(/^[a-f0-9]{40}-\d+$/);
    const videoPath = path.join('/var/bigbluebutton/published/presentation', recordingId, 'video/webcams.webm');
    expect(existsSync(videoPath), 'webcam video must be in published recording').toBe(true);
    const probe = (args: string[]) =>
      execFileSync('ffprobe', ['-v', 'error', ...args, videoPath], {
        encoding: 'utf8',
      });
    const duration = Number(probe(['-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1']));
    expect(duration, 'recorded webcam duration must be positive').toBeGreaterThan(2);
    expect(probe(['-show_entries', 'stream=codec_type', '-of', 'default=nokey=1:noprint_wrappers=1'])).toContain(
      'video',
    );
    console.log(`published webcam recording ${recordingId} duration=${duration}s`);
  } finally {
    if ((await mod.page.locator(e.meetingEndedModal).count()) === 0) {
      await apiCall('end', { meetingID: mod.meetingId, password: 'mp' }).catch(() => {});
    }
  }
});
