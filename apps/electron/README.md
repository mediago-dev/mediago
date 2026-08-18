# Electron Main Process

The Electron main process that handles the desktop application lifecycle, window management, and system integration for MediaGo.

## Overview

This package contains the Electron main process code that:

- Creates and manages application windows
- Handles system tray integration
- Manages application menus and shortcuts
- Provides native file system access
- Handles auto-updates and app packaging
- Communicates with the frontend renderer process

## Key Features

- **Window Management**: Creates and manages the main application window
- **System Integration**: System tray, notifications, and OS-specific features
- **Security**: Implements secure IPC communication with the renderer
- **Auto-Updates**: Built-in update mechanism for the desktop app
- **Cross-Platform**: Supports Windows, macOS, and Linux

## Technologies

- **Electron**: Desktop application framework
- **Node.js**: Backend runtime for main process
- **IPC**: Inter-process communication with frontend
- **Native APIs**: File system, OS integration

## Development

Run repository workflows from the repository root with the fixed Task v3.51.1.
See [CONTRIBUTING.md](../../CONTRIBUTING.md) for installation and confirm it
with `task --version` before starting.

```bash
# Install the Node workspace and pinned runtime tools
task setup

# Start the unified desktop + web development experience
task dev:all

# Start only the Electron development surface
task dev:electron

# Build electron app
task build:electron

# Package for release
task pack:electron
task release:electron

# Validate changes
task check
task test
```

## Architecture

The electron app loads the frontend React application in a BrowserWindow and provides native desktop functionality through Electron's main process APIs.
