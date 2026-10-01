import React from 'react';
import { useMutation } from '@apollo/client';
import { makePatchedQuery } from '/imports/ui/core/hooks/createUseSubscription';
import GrahqlSubscriptionStore from '/imports/ui/core/singletons/subscriptionStore';
import MEETING_SUBSCRIPTION from '/imports/ui/core/graphql/queries/meetingSubscription';
import LockViewersComponent from './component';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import { SET_LOCK_SETTINGS_PROPS, SET_WEBCAM_ONLY_FOR_MODERATOR } from './mutations';
import { SET_POLICY, SET_LOBBY_MESSAGE } from '../user-list/guest-management/waiting-users/mutations';
import useMeeting from '../../core/hooks/useMeeting';
import { useIsChatEnabled, useIsPrivateChatEnabled, useIsSharedNotesEnabled } from '../../services/features';

const LockViewersContainer = (props) => {
  const { data: currentUserData } = useCurrentUser((user) => ({
    isModerator: user.isModerator,
  }));
  const amIModerator = currentUserData?.isModerator;

  const [setLockSettingsProps] = useMutation(SET_LOCK_SETTINGS_PROPS);
  const [setWebcamOnlyForModerator] = useMutation(SET_WEBCAM_ONLY_FOR_MODERATOR);
  const [setPolicy] = useMutation(SET_POLICY);
  const [setLobbyMessageMutation] = useMutation(SET_LOBBY_MESSAGE);

  const updateLockSettings = (lockSettings) => {
    const variables = {
      disableCam: lockSettings.disableCam,
      disableMic: lockSettings.disableMic,
      disablePrivChat: lockSettings.disablePrivateChat,
      disablePubChat: lockSettings.disablePublicChat,
      disableNotes: lockSettings.disableNotes,
      hideUserList: lockSettings.hideUserList,
      lockOnJoin: lockSettings.lockOnJoin,
      lockOnJoinConfigurable: lockSettings.lockOnJoinConfigurable,
      hideViewersCursor: lockSettings.hideViewersCursor,
      hideViewersAnnotation: lockSettings.hideViewersAnnotation,
      presenterPolicy: lockSettings.presenterPolicy,
    };

    // useMeeting consumes a custom GraphQL subscription store rather than the
    // Apollo cache. Update that store optimistically so a dialog reopened before
    // the server's next subscription event starts from the latest full settings.
    GrahqlSubscriptionStore.updateSubscription(
      makePatchedQuery(MEETING_SUBSCRIPTION),
      {},
      (data) => ({
        ...data,
        meeting: data.meeting?.map((meetingInfo) => ({
          ...meetingInfo,
          lockSettings: {
            ...meetingInfo.lockSettings,
            disableCam: variables.disableCam,
            disableMic: variables.disableMic,
            disablePrivateChat: variables.disablePrivChat,
            disablePublicChat: variables.disablePubChat,
            disableNotes: variables.disableNotes,
            hideUserList: variables.hideUserList,
            lockOnJoin: variables.lockOnJoin,
            lockOnJoinConfigurable: variables.lockOnJoinConfigurable,
            hideViewersCursor: variables.hideViewersCursor,
            hideViewersAnnotation: variables.hideViewersAnnotation,
            presenterPolicy: variables.presenterPolicy,
          },
        })),
      }),
    );

    setLockSettingsProps({ variables });
  };

  const updateWebcamsOnlyForModerator = (webcamsOnlyForModerator) => {
    setWebcamOnlyForModerator({
      variables: {
        webcamsOnlyForModerator,
      },
    });
  };

  const changeGuestPolicy = (guestPolicy) => {
    setPolicy({
      variables: {
        guestPolicy,
      },
    });
  };

  const setLobbyMessage = (message) => {
    setLobbyMessageMutation({
      variables: {
        message,
      },
    });
  };

  const { setIsOpen } = props;
  const closeModal = () => setIsOpen(false);
  const { data: meeting } = useMeeting((m) => ({
    lockSettings: m.lockSettings,
    usersPolicies: m.usersPolicies,
  }));
  const isChatEnabled = useIsChatEnabled();
  const isPrivateChatEnabled = useIsPrivateChatEnabled();
  const isSharedNotesEnabled = useIsSharedNotesEnabled();

  const guestLobbyMessage = meeting?.usersPolicies?.guestLobbyMessage || '';

  return amIModerator && meeting && (
    <LockViewersComponent
      updateWebcamsOnlyForModerator={updateWebcamsOnlyForModerator}
      updateLockSettings={updateLockSettings}
      changeGuestPolicy={changeGuestPolicy}
      setLobbyMessage={setLobbyMessage}
      guestLobbyMessage={guestLobbyMessage}
      closeModal={closeModal}
      meeting={meeting}
      isChatEnabled={isChatEnabled}
      isPrivateChatEnabled={isPrivateChatEnabled}
      isSharedNotesEnabled={isSharedNotesEnabled}
      {...props}
    />
  );
};

export default LockViewersContainer;
