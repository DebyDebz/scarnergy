module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Transform import.meta (Vite pattern) to an empty object so
      // packages like zustand that check import.meta.env.MODE don't crash
      // when bundled with Metro (which doesn't support import.meta).
      function ({ types: t }) {
        return {
          visitor: {
            MetaProperty(path) {
              if (
                path.node.meta.name === 'import' &&
                path.node.property.name === 'meta'
              ) {
                path.replaceWith(t.objectExpression([]));
              }
            },
          },
        };
      },
    ],
  };
};
