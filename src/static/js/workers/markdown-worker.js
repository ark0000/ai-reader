self.addEventListener('message', function(e) {
  const { html, id } = e.data;
  
  // Regex-based HTML to Markdown converter designed for Quill output
  // Allows background processing without DOM access
  let md = html;
  
  // Headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n\n');
  
  // Inline formatting
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<(s|strike|del)[^>]*>(.*?)<\/\1>/gi, '~~$2~~');
  md = md.replace(/<u[^>]*>(.*?)<\/u>/gi, '$1'); // Markdown doesn't have underline
  
  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, p1) => {
    return '\n> ' + p1.replace(/\n/g, '\n> ') + '\n\n';
  });
  
  // FIX Bug L: Single-pass non-greedy regex fails on nested lists — it converts
  // the innermost <ul> first but leaves outer fragments with dangling <li> HTML tags.
  // Fix: loop until no <ul>/<ol> tags remain, each pass handling the innermost level.
  // This correctly serialises arbitrarily-deep nesting with 2-space indentation.
  function convertListsPass(html) {
    // Replace innermost <ul> (those that contain no child <ul>/<ol>)
    html = html.replace(/<ul[^>]*>((?:(?!<ul|<ol)[\s\S])*?)<\/ul>/gi, function(match, inner) {
      return '\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(m, liText) {
        // Indent already-converted nested lines by 2 more spaces
        return '- ' + liText.replace(/\n/g, '\n  ').trim() + '\n';
      }) + '\n';
    });
    // Replace innermost <ol> (those that contain no child <ul>/<ol>)
    html = html.replace(/<ol[^>]*>((?:(?!<ul|<ol)[\s\S])*?)<\/ol>/gi, function(match, inner) {
      let i = 1;
      return '\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(m, liText) {
        return (i++) + '. ' + liText.replace(/\n/g, '\n   ').trim() + '\n';
      }) + '\n';
    });
    return html;
  }
  // Keep converting until no list tags remain (handles arbitrary nesting depth)
  let safetyLimit = 20;
  while (/<ul|<ol/i.test(md) && safetyLimit-- > 0) {
    md = convertListsPass(md);
  }
  
  // Blocks
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n\n');
  
  // Code
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Images
  md = md.replace(/<img[^>]*alt=['"]([^'"]*)['"][^>]*src=['"]([^'"]*)['"][^>]*>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]*src=['"]([^'"]*)['"][^>]*alt=['"]([^'"]*)['"][^>]*>/gi, '![$2]($1)');
  
  // Links
  md = md.replace(/<a[^>]*href=['"]([^'"]*)['"][^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Extract custom Mermaid diagram blocks or preserve raw SVG diagrams before stripping tags
  md = md.replace(/<div[^>]*class=['"][^'"]*ql-diagram-container[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi, (match, innerHTML) => {
    let mermaidSrc = '';
    const mermaidMatch = match.match(/data-mermaid=['"]([^'"]+)['"]/i);
    if (mermaidMatch && mermaidMatch[1]) {
      try { mermaidSrc = decodeURIComponent(mermaidMatch[1]); } catch (e) {}
    }
    
    // Always convert to Base64 image for clean Markdown rendering
    const svgMatch = innerHTML.match(/<svg[\s\S]*?<\/svg>/i);
    if (svgMatch) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(svgMatch[0])));
        const titleAttr = mermaidSrc ? ` "mermaid:${encodeURIComponent(mermaidSrc)}"` : '';
        return `\n\n![Diagram](data:image/svg+xml;base64,${b64}${titleAttr})\n\n`;
      } catch(e) {
        if (mermaidSrc) return '\n```mermaid\n' + mermaidSrc.trim() + '\n```\n\n';
        return '\n<!-- diagram -->\n';
      }
    }
    
    if (mermaidSrc) return '\n```mermaid\n' + mermaidSrc.trim() + '\n```\n\n';
    return '\n<!-- diagram -->\n';
  });

  // Also catch any raw SVGs that aren't inside a ql-diagram-container
  md = md.replace(/<svg[\s\S]*?<\/svg>/gi, (svgContent) => {
    try {
      const b64 = btoa(unescape(encodeURIComponent(svgContent)));
      return `\n\n![Diagram](data:image/svg+xml;base64,${b64})\n\n`;
    } catch(e) {
      return '';
    }
  });

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');
  
  // Cleanup extra newlines
  md = md.replace(/\n{3,}/g, '\n\n');
  
  self.postMessage({ id, md: md.trim() });
});
