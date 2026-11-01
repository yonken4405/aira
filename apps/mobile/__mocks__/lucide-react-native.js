/**
 * Lucide icon double for tests: any named icon becomes a plain View with the same
 * props (including `testID`), so component tests stay fast and SVG-free.
 */

const React = require('react');
const { View } = require('react-native');

function Icon(props) {
  return React.createElement(View, props);
}

module.exports = new Proxy(
  {},
  {
    get: (_target, property) => (property === '__esModule' ? true : Icon),
  },
);
