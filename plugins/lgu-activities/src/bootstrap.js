const React = require('react');
const { createRoot } = require('react-dom/client');
const { BbbPluginSdk } = require('bigbluebutton-html-plugin-sdk');
const { isTeacher } = require('./access');
const { TeacherPanel } = require('./panel');
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
    root.render(React.createElement(TeacherPanel, { pluginApi }));
    return root; // BBB owns and unmounts this root when closing the sidekick.
  }, [pluginApi]);

  useActivitiesRegistration({ pluginApi, teacher: isTeacher(user), icon, contentFunction });
  return null;
}

module.exports = { ActivitiesBootstrap };