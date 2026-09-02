class EditorAdapter {
    constructor(quillInstance, quillContainer, markdownTextarea) {
        this.quill = quillInstance;
        this.quillContainer = quillContainer;
        this.markdownTextarea = markdownTextarea;
    }

    isVisualMode() {
        if (!this.quillContainer) return true;
        return this.quillContainer.style.display !== 'none';
    }

    insertStrategy(strategy) {
        if (!strategy) return;
        if (strategy.type === 'action') {
            if (strategy.execute) strategy.execute();
            return;
        }

        if (this.isVisualMode()) {
            this._insertIntoVisualEditor(strategy);
        } else {
            this._insertIntoMarkdownEditor(strategy);
        }
    }

    _insertIntoVisualEditor(strategy) {
        if (!this.quill) {
            console.error("[EditorAdapter] Quill instance not found for visual injection.");
            return;
        }

        const selection = this.quill.getSelection(true);
        const index = selection ? selection.index : this.quill.getLength();

        if (strategy.type === 'embed') {
            this.quill.insertEmbed(index, strategy.format, strategy.getContent(), 'user');
            this.quill.insertText(index + 1, '\n', 'user');
            this.quill.setSelection(index + 2, 'user');
        } else {
            const rawText = strategy.getContent();
            if (typeof marked !== 'undefined') {
                if (window.MarkedConfigAdapter) window.MarkedConfigAdapter.configure();
                const html = marked.parse(rawText);
                this.quill.clipboard.dangerouslyPasteHTML(index, html);
            } else {
                this.quill.insertText(index, rawText + '\n', 'user');
            }
        }
    }

    _insertIntoMarkdownEditor(strategy) {
        if (!this.markdownTextarea) {
            console.warn("[EditorAdapter] Markdown textarea not found for raw injection.");
            return;
        }
        
        let rawContent = strategy.getContent();
        
        if (strategy.type === 'embed') {
            if (typeof rawContent === 'object') {
                rawContent = "```" + (rawContent.type || "") + "\n" + (rawContent.code || "") + "\n```\n";
            } else {
                rawContent = `\n[Embed: ${strategy.format}]\n`;
            }
        }

        const mdArea = this.markdownTextarea;
        const cursor = mdArea.selectionStart;
        const text = mdArea.value;
        
        mdArea.value = text.slice(0, cursor) + rawContent + '\n' + text.slice(cursor);
        mdArea.selectionStart = cursor + rawContent.length + 1;
        mdArea.selectionEnd = cursor + rawContent.length + 1;
        mdArea.focus();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EditorAdapter;
}
