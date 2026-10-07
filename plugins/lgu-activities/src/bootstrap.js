const React = require('react');
const { createRoot } = require('react-dom/client');
const { BbbPluginSdk } = require('bigbluebutton-html-plugin-sdk');
const { LivePanel } = require('./live-panel');
const { useActivitiesRegistration } = require('./registration');

function ActivitiesBootstrap({ pluginUuid, pluginName }) {
  BbbPluginSdk.initialize(pluginUuid);
  const pluginApi = BbbPluginSdk.getPluginApi(pluginUuid, pluginName);
  const user = pluginApi.useCurrentUser();
  const icon = React.useMemo(() => React.createElement('svg', {
    viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true,
  }, React.createElement('path', { d: 'M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 7v15' })), []);
  const contentFunction = React.useCallback((element) => {
    const root = createRoot(element);
    root.render(React.createElement(LivePanel, { pluginApi }));
    return root; // BBB owns and unmounts this root when closing the sidekick.
  }, [pluginApi]);

  // Everyone in the meeting needs the learner panel. Hosting permission still
  // comes exclusively from the BFF's current verified BBB moderator proof.
  const loaded = user?.loading === false && !user.error && Boolean(user.data?.userId);
  useActivitiesRegistration({ pluginApi, teacher: loaded, icon, contentFunction });
  return null;
}

module.exports = { ActivitiesBootstrap };