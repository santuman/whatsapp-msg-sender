module.exports = {
    apps: [{
      name: "wbot-sender",
      script: "index.js",
      mode: 'fork',
      autorestart: true,
      watch: false,
      out_file: "/dev/null",
      error_file: "/dev/null"
    }]
};
