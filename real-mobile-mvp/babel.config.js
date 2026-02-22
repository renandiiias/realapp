module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Keep this as the last plugin.
      "react-native-reanimated/plugin",
    ],
  };
};
