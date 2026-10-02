import { expect } from '@playwright/test';

import { elements as e } from '../core/elements';
import { Page } from '../core/page';

export async function openPublicChat(testPage: Page) {
  const { chatEnabled } = testPage.settings || {};

  if (!chatEnabled) {
    await testPage.wasRemoved(e.messagesSidebarButton, 'public chat should not be displayed');
    return;
  }

  await testPage.hasElement(e.chatBox, 'should display the chat box for messaging');
  await testPage.hasElement(e.chatMessages, 'should display the chat messages');
  await testPage.hasElement(e.chatOptions, 'should display the chat options menu button');
}

// RC4 opens Public Chat directly in the Messages sidebar: there is no separate
// publicChatButton once the textarea is visible. Do not toggle an already open sidebar.
export async function ensurePublicChatOpen(testPage: Page): Promise<void> {
  if (!(await testPage.page.locator(e.chatBox).isVisible())) {
    await testPage.waitAndClick(e.messagesSidebarButton);
  }
  await expect(testPage.page.locator(e.chatBox)).toBeVisible();
}

export async function openPrivateChat(testPage: Page) {
  const { chatEnabled } = testPage.settings || {};
  await testPage.waitAndClick(e.usersListSidebarButton);
  await testPage.waitForSelector(e.userListItem);
  if (!chatEnabled) {
    await testPage.wasRemoved(e.startPrivateChat, 'should not display the private chat');
    return;
  }
  const lastUserStartPrivateChat = await testPage.page.locator(e.startPrivateChat).last();
  await lastUserStartPrivateChat.click();
}

export async function getLastMessageSent(testPage: Page) {
  return testPage.page.locator(e.chatUserMessageText).last();
}

export async function checkLastMessageSent(
  testPage: Page,
  expectedMessage: string | RegExp | ReadonlyArray<string | RegExp>,
) {
  const lastMessageSentLocator = await getLastMessageSent(testPage);
  await expect(lastMessageSentLocator, 'should display the last message sent on the chat').toHaveText(expectedMessage);
}

export async function hoverLastMessage(testPage: Page) {
  const lastMessageSentLocator = await getLastMessageSent(testPage);
  await lastMessageSentLocator.hover();
}
