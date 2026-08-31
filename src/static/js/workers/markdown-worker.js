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
  
  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, p1) => {
    return '\n' + p1.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
  });
  
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, p1) => {
    let i = 1;
    return '\n' + p1.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, liText) => {
      return `${i++}. ${liText}\n`;
    }) + '\n';
  });
  
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

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');
  
  // Cleanup extra newlines
  md = md.replace(/\n{3,}/g, '\n\n');
  
  self.postMessage({ id, md: md.trim() });
});
