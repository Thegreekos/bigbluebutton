import { expect, test } from '@playwright/test';

import { ELEMENT_WAIT_LONGER_TIME, ELEMENT_WAIT_TIME } from '../core/constants';
import { elements as e } from '../core/elements';
import { Page } from '../core/page';
import { MultiUsers } from '../user/multiusers';
import { viewerDrawsTwoStrokesAndErasesOne } from '../whiteboard/util';
import { startScreenshare } from './util';

export class ScreenShare extends MultiUsers {
  async startSharing() {
    const { screensharingEnabled } = this.modPage.settings || {};

    if (!screensharingEnabled) {
      await this.modPage.hasElement(e.joinVideo, 'should display the join video button');
      await this.modPage.wasRemoved(e.startScreenSharing, 'should not display the start screenshare button');
      return;
    }
    await startScreenshare(this.modPage);
    await this.modPage.hasElement(e.isSharingScreen, 'should display the screenshare element');
  }

  async startSharingMultiUser(testPage: Page) {
    const { screensharingEnabled } = this.modPage.settings || {};

    if (!screensharingEnabled) {
      await this.modPage.hasElement(e.joinVideo, 'should display the join video button');
      await this.modPage.wasRemoved(e.startScreenSharing, 'should not display the start screenshare button');
      return;
    }
    await startScreenshare(testPage);
    await testPage.hasElement(e.isSharingScreen, 'should display the screenshare element');
  }

  async testMobileDevice() {
    await this.modPage.wasRemoved(e.startScreenSharing, 'should not display the start screenshare button');
  }

  async screenshareStopsExternalVideo() {
    const { screensharingEnabled } = this.modPage.settings || {};

    await this.modPage.waitForSelector(e.whiteboard);

    if (!screensharingEnabled) {
      await this.modPage.hasElement(e.joinVideo, 'should display the join video button');
      await this.modPage.wasRemoved(e.startScreenSharing, 'should not display the screenshare button');
      return;
    }

    await this.modPage.waitAndClick(e.actions);
    await this.modPage.waitAndClick(e.shareExternalVideoBtn);
    await this.modPage.waitForSelector(e.closeModal);
    await this.modPage.fill(e.videoModalInput, e.youtubeLink);
    await this.modPage.waitAndClick(e.startShareVideoBtn);

    const modFrame = await this.modPage.getYoutubeFrame();
    await modFrame.hasElement('video', 'should display the video frame');

    await startScreenshare(this.modPage);
    await this.modPage.hasElement(e.isSharingScreen, 'should display the screenshare element');

    await this.modPage.hasElement(e.stopScreenSharing, 'should display the stop screenshare button');
    await this.modPage.waitAndClick(e.stopScreenSharing);
    await this.modPage.hasElement(e.whiteboard, 'should display the whiteboard');
  }

  // Regression: with no current presentation the layout observer closes the
  // presentation area but must also persist that state for screenshare restore.
  async webcamsFillAreaAfterSharingWithoutPresentation() {
    test.skip(!this.modPage.settings?.screensharingEnabled, 'Screen sharing is disabled');
    await this.modPage.waitForSelector(e.whiteboard, ELEMENT_WAIT_LONGER_TIME);
    await this.userPage.shareWebcam();
    await this.modPage.hasElement(e.webcamItem, 'should display the viewer webcam for the moderator');

    await this.modPage.waitAndClick(e.mediaAreaButton);
    await this.modPage.waitAndClick(e.managePresentations);
    await this.modPage.waitAndClick(e.removePresentation);
    await this.modPage.hasElementDisabled(
      e.sharePresentationButton,
      'should disable presentation sharing when no presentation is loaded',
    );
    await this.modPage.wasRemoved(e.whiteboard, 'should close the removed presentation');
    await this.modPage.page.keyboard.press('Escape');

    await startScreenshare(this.modPage);
    await this.modPage.waitAndClick(e.stopScreenSharing);
    await this.modPage.wasRemoved(e.isSharingScreen, 'should stop screensharing');
    await this.modPage.page.waitForTimeout(ELEMENT_WAIT_TIME);
    await this.modPage.wasRemoved(e.presentationContainer, 'should not reopen an empty presentation area');
    await this.modPage.wasRemoved(e.minimizePresentation, 'no minimize control should be shown');
    await this.modPage.wasRemoved(e.restorePresentation, 'no restore control should be shown');

    const webcamBox = await this.modPage.getElementBoundingBox(e.webcamItem);
    const viewport = this.modPage.page.viewportSize();
    if (!webcamBox || !viewport) throw new Error('webcam or viewport size not available');
    expect(webcamBox.height, 'the webcam should fill the media area again').toBeGreaterThan(viewport.height * 0.4);
  }

  // A reconnect or screenshare remount may replay old annotation history;
  // it must not count as a new edit that reopens a hidden presentation.
  async presentationStaysHiddenAfterSharingWithAnnotations() {
    test.skip(!this.modPage.settings?.screensharingEnabled, 'Screen sharing is disabled');
    await this.modPage.waitForSelector(e.whiteboard, ELEMENT_WAIT_LONGER_TIME);
    await this.userPage.waitForSelector(e.whiteboard, ELEMENT_WAIT_LONGER_TIME);

    await viewerDrawsTwoStrokesAndErasesOne(this.modPage, this.userPage);
    await this.modPage.waitAndClick(e.minimizePresentation);
    await this.modPage.wasRemoved(e.presentationContainer, 'should hide the presentation');
    await this.modPage.hasElement(e.restorePresentation, 'should display the restore presentation button');

    await startScreenshare(this.modPage);
    await this.modPage.waitAndClick(e.stopScreenSharing);
    await this.modPage.wasRemoved(e.isSharingScreen, 'should stop screensharing');
    await this.modPage.page.waitForTimeout(ELEMENT_WAIT_TIME);
    await this.modPage.hasElement(e.restorePresentation, 'old annotation history should not reopen the presentation');
    await this.modPage.wasRemoved(e.presentationContainer, 'the presentation should remain hidden');
    await this.modPage.wasRemoved(e.minimizePresentation, 'the minimize control should remain hidden');
  }

  async stopSharing() {
    // Stop screenshare
    await this.modPage.waitAndClick(e.stopScreenSharing);
    // Verify screenshare is stopped
    await this.modPage.wasRemoved(e.isSharingScreen, 'should not display the screenshare element after stopping');
    await this.modPage.wasRemoved(e.stopScreenSharing, 'should not display the stop screenshare button after stopping');
    await this.modPage.hasElement(e.startScreenSharing, 'should display the start screenshare button after stopping');
    await this.modPage.hasElement(e.whiteboard, 'should display the whiteboard after stopping screenshare');
  }
}
