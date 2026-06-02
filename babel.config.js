module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Transform import.meta (Vite pattern) to a safe shim so that packages
      // like zustand that check import.meta.env.MODE don't crash when bundled
      // with Metro (which doesn't support import.meta).
      // Replacing with {} alone is NOT safe — { }.env is undefined, so
      // import.meta.env.MODE would throw TypeError at runtime.
      function ({ types: t }) {
        return {
          visitor: {
            MetaProperty(path) {
              if (
                path.node.meta.name === 'import' &&
                path.node.property.name === 'meta'
              ) {
                // { env: { MODE: 'production', DEV: false } }
                path.replaceWith(
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('env'),
                      t.objectExpression([
                        t.objectProperty(
                          t.identifier('MODE'),
                          t.stringLiteral('production'),
                        ),
                        t.objectProperty(
                          t.identifier('DEV'),
                          t.booleanLiteral(false),
                        ),
                      ]),
                    ),
                  ]),
                );
              }
            },
          },
        };
      },
    ],
  };
};
