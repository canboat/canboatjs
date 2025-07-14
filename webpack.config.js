const webpack = require('webpack')

module.exports = {
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      'node:events': require.resolve('events')
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
};
