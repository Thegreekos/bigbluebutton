import { expect } from '@playwright/test';

import { elements as e } from '../core/elements';
import { apiCall, createMeeting, getJoinURL } from '../core/helpers';
import { parameters } from '../core/parameters';
import { test } from '../core/setup/fixtures';

test('isolated API create, moderator and attendee join, chat, end', async ({ browser }) => {
  const meetingID = await createMeeting(undefined, `acceptance-api-${Date.now()}`);
  const context = await browser.newContext();
  const moderator = await context.newPage();
  const attendee = await context.newPage();
  try {
    await moderator.goto(
      getJoinURL({
        meetingID,
        fullName: 'AcceptanceModerator',
        options: { isModerator: true, skipSessionDetailsModal: true },
      }),
    );
    await attendee.goto(
      getJoinURL({
        meetingID,
        fullName: 'AcceptanceAttendee',
        options: { isModerator: false, skipSessionDetailsModal: true },
      }),
    );
    // Use the same stable audio-modal selector as core/Page.closeAudioModal.
    for (const page of [moderator, attendee]) {
      await page.locator('div#layout').waitFor({ timeout: 30_000 });
      const modal = page.locator(e.audioModal);
      await modal.waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator(e.closeModal).click();
      await expect(modal).toBeHidden();
    }
    await expect(moderator.locator(e.usersListSidebarButton)).toBeVisible();
    await expect(attendee.locator(e.usersListSidebarButton)).toBeVisible();
    const message = `api-smoke-${Date.now()}`;
    await attendee.locator(e.chatBox).fill(message);
    await attendee.locator(e.sendButton).click();
    await expect(moderator.locator(e.chatUserMessageText).filter({ hasText: message })).toBeVisible();
  } finally {
    const result = await apiCall<{ response: { returncode: string[] } }>('end', {
      meetingID,
      password: parameters.moderatorPW,
    });
    expect(result.data.response.returncode?.[0]).toBe('SUCCESS');
    await context.close();
  }
});
