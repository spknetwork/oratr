const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

/**
 * Cross-platform daemon manager
 * Provides a unified interface for creating system services/daemons
 */
class DaemonManager extends EventEmitter {
  constructor() {
    super();
    this.platform = os.platform();
  }

  /**
   * Check if daemon/service management is available
   */
  async isAvailable() {
    switch (this.platform) {
      case 'win32':
        // Check if running with admin privileges
        try {
          await fs.access('C:\\Windows\\System32', fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      
      case 'darwin':
        // Check if we can write to LaunchAgents
        try {
          const launchAgentsPath = path.join(os.homedir(), 'Library', 'LaunchAgents');
          await fs.access(launchAgentsPath, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      
      case 'linux':
        // Check for systemd
        try {
          const { execSync } = require('child_process');
          execSync('which systemctl', { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      
      default:
        return false;
    }
  }

  /**
   * Install a daemon/service
   */
  async install(config) {
    const { name, displayName, description, script, args = [], env = {} } = config;

    switch (this.platform) {
      case 'win32':
        return this.installWindows(config);
      case 'darwin':
        return this.installMacOS(config);
      case 'linux':
        return this.installLinux(config);
      default:
        throw new Error(`Platform ${this.platform} not supported`);
    }
  }

  /**
   * Install Windows service
   */
  async installWindows(config) {
    // For Windows, we would use node-windows package
    // This is a placeholder for the implementation
    throw new Error('Windows service installation not yet implemented');
  }

  /**
   * Install macOS launchd service
   */
  async installMacOS(config) {
    const { name, displayName, description, script, args = [], env = {} } = config;
    
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.spk.${name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${script}</string>
        ${args.map(arg => `<string>${arg}</string>`).join('\n        ')}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        ${Object.entries(env).map(([key, value]) => 
          `<key>${key}</key>\n        <string>${value}</string>`
        ).join('\n        ')}
    </dict>
</dict>
</plist>`;

    const plistPath = path.join(
      os.homedir(),
      'Library',
      'LaunchAgents',
      `io.spk.${name}.plist`
    );

    await fs.writeFile(plistPath, plistContent, 'utf8');
    
    // Load the service
    const { exec } = require('child_process');
    await new Promise((resolve, reject) => {
      exec(`launchctl load ${plistPath}`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    return { success: true, path: plistPath };
  }

  /**
   * Install Linux systemd service
   */
  async installLinux(config) {
    const { name, displayName, description, script, args = [], env = {} } = config;
    
    const serviceContent = `[Unit]
Description=${description || displayName}
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${script} ${args.join(' ')}
Restart=always
RestartSec=10
${Object.entries(env).map(([key, value]) => `Environment="${key}=${value}"`).join('\n')}

[Install]
WantedBy=multi-user.target`;

    const servicePath = `/etc/systemd/system/spk-${name}.service`;
    
    // This would need sudo privileges
    throw new Error('Linux systemd installation requires sudo privileges. Run with elevated permissions.');
  }

  /**
   * Start a daemon/service
   */
  async start(name) {
    switch (this.platform) {
      case 'win32':
        throw new Error('Windows service control not yet implemented');
      
      case 'darwin':
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec(`launchctl start io.spk.${name}`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        break;
      
      case 'linux':
        throw new Error('Linux systemd control requires sudo privileges');
      
      default:
        throw new Error(`Platform ${this.platform} not supported`);
    }
  }

  /**
   * Stop a daemon/service
   */
  async stop(name) {
    switch (this.platform) {
      case 'win32':
        throw new Error('Windows service control not yet implemented');
      
      case 'darwin':
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec(`launchctl stop io.spk.${name}`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        break;
      
      case 'linux':
        throw new Error('Linux systemd control requires sudo privileges');
      
      default:
        throw new Error(`Platform ${this.platform} not supported`);
    }
  }

  /**
   * Uninstall a daemon/service
   */
  async uninstall(name) {
    switch (this.platform) {
      case 'win32':
        throw new Error('Windows service uninstall not yet implemented');
      
      case 'darwin':
        const plistPath = path.join(
          os.homedir(),
          'Library',
          'LaunchAgents',
          `io.spk.${name}.plist`
        );
        
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
          exec(`launchctl unload ${plistPath}`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        
        await fs.unlink(plistPath);
        break;
      
      case 'linux':
        throw new Error('Linux systemd uninstall requires sudo privileges');
      
      default:
        throw new Error(`Platform ${this.platform} not supported`);
    }
  }

  /**
   * Get status of a daemon/service
   */
  async status(name) {
    switch (this.platform) {
      case 'win32':
        throw new Error('Windows service status not yet implemented');
      
      case 'darwin':
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          exec(`launchctl list | grep io.spk.${name}`, (error, stdout) => {
            if (error || !stdout) {
              resolve({ running: false });
            } else {
              const parts = stdout.trim().split('\t');
              resolve({
                running: parts[0] !== '-',
                pid: parts[0] !== '-' ? parseInt(parts[0]) : null
              });
            }
          });
        });
      
      case 'linux':
        throw new Error('Linux systemd status requires different approach');
      
      default:
        throw new Error(`Platform ${this.platform} not supported`);
    }
  }

  /**
   * Alternative: Use PM2 for cross-platform process management
   */
  async installPM2Service(config) {
    const { name, script, args = [], env = {} } = config;
    
    // Check if PM2 is installed
    try {
      const { execSync } = require('child_process');
      execSync('pm2 --version', { stdio: 'ignore' });
    } catch {
      throw new Error('PM2 is not installed. Install it with: npm install -g pm2');
    }

    // Start the process with PM2
    const { exec } = require('child_process');
    const pm2Args = [
      'start',
      script,
      '--name', name,
      ...args.flatMap(arg => ['--', arg]),
      ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    ];

    await new Promise((resolve, reject) => {
      exec(`pm2 ${pm2Args.join(' ')}`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Save PM2 configuration
    await new Promise((resolve, reject) => {
      exec('pm2 save', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Set up PM2 to start on boot (platform-specific)
    if (this.platform === 'linux' || this.platform === 'darwin') {
      console.log('Run "pm2 startup" to configure PM2 to start on boot');
    }

    return { success: true, manager: 'pm2' };
  }
}

module.exports = DaemonManager;