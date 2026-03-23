module.exports = {
  apps: [{
    name: 'elaris',
    script: 'src/index.js',
    node_args: '--env-file=.env',
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
