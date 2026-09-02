class TemplateManager {
    static STRATEGIES = {
        'deep_dive': {
            label: 'Function Deep-Dive',
            icon: '🧩',
            type: 'text',
            getContent: () => `\n# 🧩 Module / Function: \n\n### 1. Theory vs Code\n* **Theory:** \n* **What is the code:** \n\n### 2. The Contract (I/O)\n* **Inputs (Args / Payload):**\n  - \n* **Outputs (Returns / Side-effects):**\n  - \n\n### 3. Processing Steps\n1. \n`
        },
        'data_journey': {
            label: 'State Mutation',
            icon: '📦',
            type: 'text',
            getContent: () => `\n# 📦 Data Journey: \n\n### 1. The Core Schema\n\`\`\`typescript\ninterface ObjectName {\n   // Key fields\n}\n\`\`\`\n\n### 2. Lifecycle & Mutations\n* **Birth (Where is it created?):** \n* **Mutators (Who changes it?):**\n  - \n* **Death / Storage (Where does it go?):** \n`
        },
        'adr_gotcha': {
            label: 'Gotcha / Decision Log (ADR)',
            icon: '⚠️',
            type: 'text',
            getContent: () => `\n# ⚠️ Gotcha / Decision: \n\n* **The Weird Code:** \n* **The "Why" (Business Rule/Constraint):** \n* **The Solution:** \n* **Impact:** \n`
        },
        'glossary_term': {
            label: 'Domain Glossary Term',
            icon: '📖',
            type: 'text',
            getContent: () => `\n# 📖 Glossary: \n\n* **Definition:** \n* **Used In:** \n* **Example:** \n* **Synonyms / Related Concepts:** \n`
        },
        'mindmap': {
            label: 'Mindmap',
            icon: '🧠',
            type: 'embed',
            format: 'custom-diagram',
            getContent: () => ({ code: 'mindmap\n  root\n    Node A\n    Node B', type: 'mermaid' })
        },
        'flashcard': {
            label: 'Flashcard',
            icon: '📇',
            type: 'text',
            getContent: () => `\n# 📇 Flashcard\n\n**Q:** \n\n---\n\n**A:** \n`
        }
    };

    static getAvailableTemplates() {
        return Object.keys(this.STRATEGIES).map(key => ({
            id: key,
            ...this.STRATEGIES[key]
        }));
    }

    static renderDropdown(containerElement, onSelectCallback) {
        if (!containerElement) return;

        containerElement.innerHTML = ''; // Clear container

        const templates = this.getAvailableTemplates();
        
        templates.forEach(template => {
            const btn = document.createElement('button');
            btn.className = 'tb-btn template-item-btn';
            // Styling to match a dropdown item look
            btn.style.padding = '10px 14px';
            btn.style.border = 'none';
            btn.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
            btn.style.background = 'transparent';
            btn.style.textAlign = 'left';
            btn.style.borderRadius = '0';
            btn.style.width = '100%';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.gap = '8px';
            btn.style.color = 'var(--text-1)';
            btn.style.cursor = 'pointer';
            
            btn.dataset.templateId = template.id;
            
            btn.innerHTML = `<span style="font-size:16px;">${template.icon}</span> <span>${template.label}</span>`;
            
            // Hover effect
            btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.05)';
            btn.onmouseout = () => btn.style.background = 'transparent';

            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelectCallback(template);
            };

            containerElement.appendChild(btn);
        });
    }
}

// Export for Node/Jest testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TemplateManager;
}



