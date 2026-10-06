const React = require('react');
const { GenericContentSidekickArea } = require('bigbluebutton-html-plugin-sdk');

const PANEL_ID = 'lgu-activities-panel';

// BBB4 automatically registers generic sidekicks in Apps Gallery.
// An explicit AppsGalleryEntry would create a second app.
function useActivitiesRegistration({ pluginApi, teacher, icon, contentFunction }) {
  React.useEffect(() => {
    pluginApi.setGenericContentItems(teacher ? [new GenericContentSidekickArea({
      id: PANEL_ID,
      name: 'LGU Activities',
      section: 'Apps',
      buttonIcon: { svgContent: icon },
      open: false,
      dataTest: PANEL_ID,
      contentFunction,
    })] : []);
    return () => pluginApi.setGenericContentItems([]);
  }, [pluginApi, teacher, icon, contentFunction]);
}

module.exports = { PANEL_ID, useActivitiesRegistration };