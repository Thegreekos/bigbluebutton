const React = require('react');
const { BbbPluginSdk } = require('bigbluebutton-html-plugin-sdk');
const { useActivitiesRegistration } = require('./registration');
const { useLiveRuntime } = require('./live-runtime');
const { createPlayerMainContent } = require('./player-stage');
const { publishController } = require('./controller-store');

function ActivitiesBootstrap({ pluginUuid, pluginName }) {
  BbbPluginSdk.initialize(pluginUuid);
  const pluginApi = BbbPluginSdk.getPluginApi(pluginUuid, pluginName);
  const user = pluginApi.useCurrentUser();
  const runtime = useLiveRuntime(pluginApi, user);
  const { controller, playerAuth } = runtime;
  const sessionId = controller.showMainStage ? controller.session.id : '';
  const mainContentFunction = React.useMemo(() => sessionId ? createPlayerMainContent({
    pluginApi, sessionToken: playerAuth.sessionToken, coreToken: playerAuth.coreToken, sessionId, spectator: false,
  }) : null, [pluginApi, playerAuth.sessionToken, playerAuth.coreToken, sessionId]);
  const icon = React.useMemo(() => React.createElement('svg', {
    viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
  }, React.createElement('path', { d: 'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 7v15' })), []);
  React.useEffect(() => { publishController(controller); }, [controller]);
  React.useEffect(() => () => publishController(null), []);
  useActivitiesRegistration({ pluginApi, teacher: controller.canHost, icon,
    activeSessionId: sessionId, mainContentFunction });
  return null;
}

module.exports = { ActivitiesBootstrap };