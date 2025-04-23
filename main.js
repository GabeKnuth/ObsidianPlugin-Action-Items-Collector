const { Plugin } = require('obsidian');

class ActionItemsPlugin extends Plugin {
    // Initialize class properties
    isProcessing = false;
    lastChangeTime = 0;
    lastContent = "";
    actionItemLines = new Set(); // Track which line numbers contain action items
    
    onload() {
        console.log('Loading Action Items plugin');
        
        // Add a command to manually trigger collection
        this.addCommand({
            id: 'collect-action-items',
            name: 'Collect Action Items',
            editorCallback: (editor) => {
                if (editor) {
                    this.collectActionItems(editor);
                }
            }
        });
        
        // Register for editor changes with more targeted approach
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (!editor) return;
                
                // Get cursor position and current line
                const cursor = editor.getCursor();
                const currentLine = editor.getLine(cursor.line);
                
                // Skip if we're not at the beginning of typing in this line
                // Only process if cursor is near the beginning of the line
                // or if this line is already known to be an action item
                if (currentLine && (
                    cursor.ch <= 10 || // Only process if cursor is at the beginning of a line
                    this.isActionItemLine(currentLine) || // Or if it's already an action item
                    this.actionItemLines.has(cursor.line) // Or if we've tracked it as an action item
                )) {
                    // Check if this might be an action item line (whitespace + //)
                    if (this.isActionItemLine(currentLine)) {
                        // Track this line as an action item
                        this.actionItemLines.add(cursor.line);
                        
                        // Update action items immediately when editing an action item
                        this.checkForActionItems(editor);
                    } else if (this.actionItemLines.has(cursor.line)) {
                        // If a line was an action item but no longer is, update
                        this.actionItemLines.delete(cursor.line);
                        this.checkForActionItems(editor);
                    }
                } else {
                    // For non-action item changes, use throttled updates
                    const now = Date.now();
                    if (now - this.lastChangeTime > 500) { // Increased throttle time
                        this.lastChangeTime = now;
                        
                        // Periodically scan and update action item list
                        // This catches action items created by paste, etc.
                        this.updateActionItemLineTracking(editor);
                        this.checkForActionItems(editor);
                    }
                }
            })
        );
        
        // Also register for cursor activity to catch click events
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (activeLeaf && activeLeaf.view && activeLeaf.view.editor) {
                    const editor = activeLeaf.view.editor;
                    
                    // Refresh our tracking of action item lines
                    this.updateActionItemLineTracking(editor);
                    
                    // Then check for action items
                    this.checkForActionItems(editor);
                }
            })
        );
    }
    
    // Helper method to determine if a line is an action item
    isActionItemLine(line) {
        if (!line) return false;
        return line.trim().startsWith("//");
    }
    
    // Update our tracking of which lines contain action items
    updateActionItemLineTracking(editor) {
        if (!editor) return;
        
        // Clear existing tracking
        this.actionItemLines.clear();
        
        // Get all lines
        const lineCount = editor.lineCount();
        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            if (this.isActionItemLine(line)) {
                this.actionItemLines.add(i);
            }
        }
    }

    checkForActionItems(editor) {
        // Avoid recursive calls that could cause stack overflow
        if (this.isProcessing) return;
        
        try {
            this.isProcessing = true;
            
            // Skip processing if in the middle of typing the action item marker
            const cursor = editor.getCursor();
            const currentLine = editor.getLine(cursor.line);
            
            // Skip processing during vulnerable typing moments to prevent cursor jumps
            if (currentLine) {
                const trimmed = currentLine.trim();
                if (trimmed === "/" || trimmed === "//" || trimmed === "// ") {
                    return; // Skip to avoid interrupting typing
                }
            }
            
            this.collectActionItems(editor);
        } finally {
            this.isProcessing = false;
        }
    }

    collectActionItems(editor) {
        if (!editor) return;
        
        try {
            // Save cursor position
            const cursor = editor.getCursor();
            const scrollInfo = editor.getScrollInfo();
            
            // Track if we're currently on an action item line
            const cursorOnActionItem = this.isActionItemLine(editor.getLine(cursor.line));
            
            // Get content
            const content = editor.getValue();
            const lines = content.split('\n');
            
            // Collect action items
            const actionItems = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith("//")) {
                    // Extract the action item text (without //)
                    let actionItem = line.substring(2).trim();
                    
                    if (actionItem) {
                        // Store action item text
                        actionItems.push(actionItem);
                    }
                }
            }
            
            if (actionItems.length === 0) {
                // If no action items exist, remove the section if it exists
                this.removeActionItemsSection(editor, lines);
                return;
            }
            
            // Format action items as bullet points
            const formattedItems = actionItems.map(item => `- ${item}`);
            
            // Check for existing Action Items section
            let hasSection = false;
            let sectionIndex = -1;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i] === "# Action Items") {
                    hasSection = true;
                    sectionIndex = i;
                    break;
                }
            }
            
            // Calculate how many lines will be added/changed
            let lineDifference = 0;
            
            // Build new content
            let newLines;
            
            if (hasSection) {
                // Find where the section ends
                let endIndex = sectionIndex + 1;
                while (endIndex < lines.length && 
                      (lines[endIndex].startsWith("- ") || lines[endIndex].trim() === "")) {
                    endIndex++;
                }
                
                // Skip the update if not editing an action item and the content is the same
                if (!cursorOnActionItem) {
                    const currentSectionContent = lines.slice(sectionIndex + 1, endIndex).join('\n');
                    const newSectionContent = formattedItems.join('\n');
                    
                    if (currentSectionContent.trim() === newSectionContent.trim()) {
                        // No changes needed
                        return;
                    }
                }
                
                // Replace existing section
                newLines = [
                    ...lines.slice(0, sectionIndex + 1),
                    ...formattedItems,
                    "",
                    ...lines.slice(endIndex)
                ];
                
                // Calculate line difference
                lineDifference = (formattedItems.length + 1) - (endIndex - (sectionIndex + 1));
            } else {
                // Add new section at the top
                newLines = [
                    "# Action Items",
                    ...formattedItems,
                    "",
                    ...lines
                ];
                
                // Calculate line difference (added lines)
                lineDifference = formattedItems.length + 3; // header + items + blank line
            }
            
            // Update content
            editor.setValue(newLines.join('\n'));
            
            // Calculate new cursor position with bounds checking
            let newLine = cursor.line;
            if (cursor.line >= sectionIndex || !hasSection) {
                newLine = cursor.line + lineDifference;
            }
            
            // Make sure the cursor position is valid
            const lineCount = editor.lineCount();
            if (newLine >= lineCount) {
                newLine = lineCount - 1;
            }
            if (newLine < 0) {
                newLine = 0;
            }
            
            // Get the length of the line to ensure ch is valid
            const lineLength = editor.getLine(newLine)?.length || 0;
            let newCh = cursor.ch;
            if (newCh > lineLength) {
                newCh = lineLength;
            }
            
            // Set cursor position with validated values
            editor.setCursor({
                line: newLine,
                ch: newCh
            });
            
            // Restore scroll position
            editor.scrollTo(scrollInfo.left, scrollInfo.top);
            
            // Update our tracking of action item lines after processing
            this.updateActionItemLineTracking(editor);
        } catch (error) {
            console.error("Error in ActionItemsPlugin:", error);
            // Don't rethrow the error so the plugin continues to function
        }
    }
    
    removeActionItemsSection(editor, lines) {
        try {
            // Find the section if it exists
            let sectionIndex = -1;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i] === "# Action Items") {
                    sectionIndex = i;
                    break;
                }
            }
            
            if (sectionIndex === -1) return; // No section to remove
            
            // Find where the section ends
            let endIndex = sectionIndex + 1;
            while (endIndex < lines.length && 
                (lines[endIndex].startsWith("- ") || lines[endIndex].trim() === "")) {
                endIndex++;
            }
            
            // Remove the section
            const newLines = [
                ...lines.slice(0, sectionIndex),
                ...lines.slice(endIndex)
            ];
            
            // Save cursor position
            const cursor = editor.getCursor();
            const scrollInfo = editor.getScrollInfo();
            
            // Update content
            editor.setValue(newLines.join('\n'));
            
            // Calculate new cursor position
            let newLine = cursor.line;
            if (cursor.line > endIndex) {
                // If cursor was below the section, adjust it up
                newLine = cursor.line - (endIndex - sectionIndex);
            } else if (cursor.line > sectionIndex && cursor.line < endIndex) {
                // If cursor was inside the section, move it to where the section started
                newLine = sectionIndex;
            }
            
            // Make sure the cursor position is valid
            const lineCount = editor.lineCount();
            if (newLine >= lineCount) {
                newLine = lineCount - 1;
            }
            if (newLine < 0) {
                newLine = 0;
            }
            
            // Get the length of the line to ensure ch is valid
            const lineLength = editor.getLine(newLine)?.length || 0;
            let newCh = cursor.ch;
            if (newCh > lineLength) {
                newCh = lineLength;
            }
            
            // Set cursor position with validated values
            editor.setCursor({
                line: newLine,
                ch: newCh
            });
            
            // Restore scroll position
            editor.scrollTo(scrollInfo.left, scrollInfo.top);
        } catch (error) {
            console.error("Error in ActionItemsPlugin removeSection:", error);
        }
    }
    
    onunload() {
        console.log('Unloading Action Items plugin');
    }
}

module.exports = ActionItemsPlugin;