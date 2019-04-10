var path = require('path');

module.exports = {
  entry: './webpack.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webpack-canboat.js',
    library: 'canboatjs',
    libraryTarget: 'umd'
  },
  externals: {
    lodash: {
      commonjs: 'lodash',
      commonjs2: 'lodash',
      amd: 'lodash',
      root: '_'
     }
  }
};
