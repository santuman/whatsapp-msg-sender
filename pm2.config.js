module.exports = {
    apps: [{
      name: "wbot-sender",
      script: "index.js",
      cwd: __dirname,
      mode: 'fork',
      autorestart: true,
      watch: false,
      out_file: "/dev/null",
      error_file: "/dev/null"
    }]
};
