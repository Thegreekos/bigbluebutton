const React = require('react');
const { GenericContentSidekickArea, GenericContentMainArea } = require('bigbluebutton-html-plugin-sdk');

const PANEL_ID = 'lgu-activities-panel';

// BBB4 automatically registers generic sidekicks in Apps Gallery.
// An explicit AppsGalleryEntry would create a second app.
function useActivitiesRegistration({ pluginApi, teacher, icon, activeSessionId, mainContentFunction }) {
  const controllerContentFunction = React.useCallback(element => {
    const root = require('react-dom/client').createRoot(element);
    const { ControllerPanel } = require('./controller-panel');
    root.render(React.createElement(ControllerPanel));
    return root;
  }, []);
  React.useEffect(() => {
    const items = [];
    if (teacher) items.push(new GenericContentSidekickArea({
      id: PANEL_ID,
      name: 'LGU Activities',
      section: 'Apps',
      buttonIcon: { svgContent: icon },
      open: false,
      dataTest: PANEL_ID,
      contentFunction: controllerContentFunction,
    }));
    if (activeSessionId) items.push(new GenericContentMainArea({
      id: `lgu-live-main-${activeSessionId}`,
      dataTest: 'lgu-live-main-stage',
      contentFunction: mainContentFunction,
    }));
    pluginApi.setGenericContentItems(items);
  }, [pluginApi, teacher, icon, activeSessionId, mainContentFunction, controllerContentFunction]);
  React.useEffect(() => () => pluginApi.setGenericContentItems([]), [pluginApi]);
}

module.exports = { PANEL_ID, useActivitiesRegistration };