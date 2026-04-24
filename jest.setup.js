/* global jest */

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    GestureHandlerRootView: ({ children }) => React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }) => {
    const React = require('react');
    return React.createElement(React.Fragment, null, children);
  },
  DarkTheme: { colors: {} },
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => {
    const React = require('react');
    return {
      Navigator: ({ children }) => React.createElement(React.Fragment, null, React.Children.toArray(children)[0]),
      Screen: ({ component: Component }) => Component
        ? React.createElement(Component, {
          navigation: { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() },
          route: { params: {} },
        })
        : null,
    };
  },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => {
    const React = require('react');
    return {
      Navigator: ({ children }) => React.createElement(React.Fragment, null, React.Children.toArray(children)[0]),
      Screen: ({ component: Component }) => Component
        ? React.createElement(Component, {
          navigation: { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() },
          route: { params: {} },
        })
        : null,
    };
  },
}));

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const values = new Map();
    return {
      getString: key => values.get(key),
      set: (key, value) => values.set(key, value),
      delete: key => values.delete(key),
    };
  },
}));

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WebView: props => React.createElement(View, props) };
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('react-native-vision-camera', () => ({
  Camera: () => null,
  useCameraDevice: () => null,
  useCameraPermission: () => ({ hasPermission: false, requestPermission: jest.fn(() => Promise.resolve(false)) }),
  useCodeScanner: config => config,
}));

jest.mock('react-native-markdown-display', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ children }) => React.createElement(Text, null, children);
});
