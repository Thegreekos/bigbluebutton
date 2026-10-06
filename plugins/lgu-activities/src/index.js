const React = require('react');
const { createRoot } = require('react-dom/client');
const { ActivitiesBootstrap } = require('./bootstrap');

// Official loader-provided mount only; never insert UI into BBB's DOM.
const script = document.currentScript;
const pluginUuid = script?.getAttribute('uuid');
const pluginName = script?.getAttribute('pluginName') || 'LGUActivities';
const element = pluginUuid && document.getElementById(pluginUuid);
if (element) {
  createRoot(element).render(React.createElement(ActivitiesBootstrap, { pluginUuid, pluginName }));
}