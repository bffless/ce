# Repository Browser - User Guide

Welcome to the BFFless' Repository Browser! This guide will help you navigate and use all the features of the repository browser.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Navigating Files](#navigating-files)
3. [Viewing Content](#viewing-content)
4. [Using the Ref Selector](#using-the-ref-selector)
5. [Searching Files](#searching-files)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Mobile Usage](#mobile-usage)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Accessing a Repository

Navigate to a repository using one of these URL patterns:

- **Without ref** (uses default): `/repo/:owner/:repo`
- **With specific ref**: `/repo/:owner/:repo/:ref`
- **With file path**: `/repo/:owner/:repo/:ref/:filepath`

**Example:**

```
https://example.com/repo/mycompany/my-site/main
https://example.com/repo/mycompany/my-site/main/index.html
```

### Understanding the Layout

The repository browser has three main areas:

1. **File Browser Sidebar** (left): Tree view of all files
2. **Content Viewer** (center): Displays file content
3. **Header** (top): Navigation, ref selector, and controls

---

## Navigating Files

### File Tree

The file tree shows all files in your deployment:

- **📁 Folders**: Click to expand/collapse
- **📄 Files**: Click to view content
- **Active file**: Highlighted in blue
- **Indentation**: Shows folder nesting

### Expanding Folders

- **Click folder name or chevron**: Expands/collapses folder
- **Shift+Click** (coming soon): Expand all subfolders

### Breadcrumb Navigation

At the top of the content viewer, breadcrumbs show your current location:

```
owner / repo / main / src / components / Button.tsx
  ↑      ↑      ↑     ↑        ↑            ↑
click  click  click  click   click      current file
```

Click any segment to navigate up the directory tree.

---

## Viewing Content

### File Types

The browser supports multiple file types with specialized viewers:

#### **Code Files** (`.js`, `.ts`, `.css`, `.html`, etc.)

- Syntax highlighting with Shiki
- Line numbers
- Copy button
- Word wrap toggle
- Download button

#### **HTML Files**

- **Preview Tab**: Live preview in sandboxed iframe
- **Code Tab**: Syntax-highlighted source code
- **Refresh button**: Reload preview
- **Open in new tab**: View fullscreen

#### **Images** (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`)

- Display at actual size
- Zoom controls (+/-)
- Pan with mouse drag
- Image dimensions and file size shown
- Checkerboard background for transparency

#### **Other Files**

- Download option
- View raw content

### Tabs

Switch between different views using tabs:

- **Code**: View source code with syntax highlighting
- **Preview**: Live preview (HTML files only)
- **History**: View deployment history (coming soon)

**Keyboard Shortcuts:**

- `Alt+C`: Switch to Code tab
- `Alt+P`: Switch to Preview tab
- `Alt+H`: Switch to History tab

### File Actions

At the top of the content viewer:

- **📋 Copy URL**: Copy public URL to clipboard
- **⬇️ Download**: Download file
- **👁️ View Raw**: Open raw file in new tab
- **🔗 Share**: Share file (if supported by browser)

---

## Using the Ref Selector

The ref selector lets you navigate between different versions of your repository.

### Opening the Ref Selector

Click the ref badge in the header (e.g., "main", "abc123d") to open the dropdown.

### Ref Types

**Aliases** (🏷️)

- Named references (e.g., "production", "staging")
- Set via API or deployment config

**Branches** (🌿)

- Git branch names (e.g., "main", "develop")
- Shows latest deployed commit

**Recent Commits** (📝)

- Last 10 commits deployed
- Shows short SHA, branch, and time

### Switching Refs

1. Click the ref selector
2. Search or scroll to find desired ref
3. Click to switch

**Note**: When switching refs, the browser tries to maintain your current file path. If the file doesn't exist in the new ref, you'll be redirected to the repository overview.

### Default Ref

When visiting `/repo/:owner/:repo` without a ref, the system uses this priority:

1. "production" alias
2. "main" alias
3. "main" branch
4. "master" branch
5. Most recent commit

---

## Searching Files

### Basic Search

1. Click the search box at the top of the file browser
2. Type your search query
3. Results filter in real-time

**Search behavior:**

- Case-insensitive
- Searches file names only (not content)
- Automatically expands folders with matches

### Keyboard Shortcuts

- **`/`**: Focus search box
- **`Esc`**: Clear search

### Tips

- Search for file extensions: `.js`, `.css`
- Search for partial names: `index` matches `index.html`, `index.css`
- Folders containing matches auto-expand

---

## Keyboard Shortcuts

### Navigation

- **`/`**: Focus search
- **`Esc`**: Clear search
- **`Tab`**: Navigate between UI elements
- **`Enter`**: Select focused file/folder
- **`Arrow Keys`**: Navigate tree (when focused)

### Tabs

- **`Alt+C`**: Switch to Code tab
- **`Alt+P`**: Switch to Preview tab
- **`Alt+H`**: Switch to History tab

### Content Viewer

- **`Ctrl/Cmd+C`**: Copy selected text
- **`Ctrl/Cmd+F`**: Find in page (browser default)

---

## Mobile Usage

The repository browser is fully responsive and optimized for mobile devices.

### Accessing the Sidebar

On mobile (<768px width), the file browser is hidden by default:

1. **Tap the hamburger menu** (☰) in the top-left
2. Sidebar opens as a full-screen drawer
3. **Tap a file** to view it
4. Sidebar automatically closes

### Gestures

- **Swipe to dismiss**: Close sidebar drawer
- **Pinch to zoom**: Zoom images in image viewer
- **Two-finger pan**: Pan zoomed images

### Portrait vs. Landscape

- **Portrait**: Single-column layout, hamburger menu
- **Landscape**: May show sidebar automatically (tablets)

---

## Troubleshooting

### Common Issues

#### "Repository not found" (404)

- Check that the repository owner and name are correct
- Verify the repository has been deployed
- Check that you have permission to access (for private repos)

#### "File not found"

- File may not exist in this ref
- Try switching to a different branch/commit
- Check the file path in the URL

#### Preview not loading

- Check browser console for errors
- Ensure HTML file references are correct
- Try refreshing the preview (🔄 button)

#### Images not displaying

- Check file format is supported (PNG, JPG, GIF, WebP, SVG)
- Ensure image URL is correct
- Check browser console for CORS errors

#### Slow loading

- Large files may take time to load
- Check your internet connection
- Try refreshing the page

### Getting Help

If you encounter issues:

1. Check the browser console (F12) for errors
2. Try refreshing the page (Ctrl/Cmd+R)
3. Clear browser cache
4. Contact your administrator

---

## Best Practices

### For Optimal Performance

- **Use modern browsers**: Chrome, Firefox, Safari, Edge (latest versions)
- **Keep file sizes reasonable**: Large files (>10MB) may load slowly
- **Optimize images**: Use compressed formats when possible

### For Best Experience

- **Use breadcrumbs**: Navigate up directory tree quickly
- **Learn keyboard shortcuts**: Speed up your workflow
- **Bookmark frequently used refs**: Save time navigating
- **Use search**: Find files quickly in large repositories

---

## Features Coming Soon

- **History tab**: View deployment timeline
- **File blame**: See who deployed each change
- **Diff viewer**: Compare versions
- **Markdown rendering**: Rich preview for `.md` files
- **Code folding**: Collapse code sections
- **Minimap**: Navigate large files easily

---

## Privacy & Security

### Sandboxing

HTML previews run in a sandboxed iframe with restricted permissions:

- Scripts can run but can't access parent page
- Same-origin policy prevents cross-site attacks
- Forms can be submitted

### Authentication

- Public repositories: No authentication required
- Private repositories: Requires valid session or API key
- Permissions checked on every request

---

## Technical Details

### Supported File Types

**Code & Markup**

- JavaScript/TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`)
- HTML/CSS (`.html`, `.css`, `.scss`, `.sass`)
- JSON/YAML (`.json`, `.yaml`, `.yml`)
- Markdown (`.md`, `.mdx`)
- Shell scripts (`.sh`, `.bash`)
- Python (`.py`)
- Ruby (`.rb`)
- And 50+ more languages

**Images**

- PNG, JPEG, GIF, WebP, SVG

**Others**

- Plain text (`.txt`)
- Configuration files
- And more...

### Browser Compatibility

| Browser                 | Minimum Version | Status             |
| ----------------------- | --------------- | ------------------ |
| Chrome                  | 90+             | ✅ Fully supported |
| Firefox                 | 88+             | ✅ Fully supported |
| Safari                  | 14+             | ✅ Fully supported |
| Edge                    | 90+             | ✅ Fully supported |
| Mobile Safari (iOS)     | 14+             | ✅ Fully supported |
| Mobile Chrome (Android) | 90+             | ✅ Fully supported |

---

**Need more help?** Check the [Developer Guide](./DEVELOPER-GUIDE.md) or contact support.
