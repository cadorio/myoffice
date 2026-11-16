'use strict';

// Leitura e escrita de ficheiros do Word (.docx), Excel (.xlsx) e PowerPoint (.pptx).
// Estes formatos são arquivos ZIP com XML lá dentro; a conversão cobre o conteúdo e a formatação
// mais comuns (ver o README para os limites).
(function () {
  const MO = (window.MO = window.MO || {});
  const zipLib = window.fflate;
  const F = MO.Formula;

  const MAX_ENTRY = 40 * 1024 * 1024; // maior ficheiro aceite dentro do arquivo
  const MAX_TOTAL = 150 * 1024 * 1024; // total descomprimido aceite (proteção contra "zip bombs")
  const EMU = 9525; // EMU por píxel a 96 ppp
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // ---------- Utilitários ----------

  function unzip(bytes) {
    let total = 0;
    return zipLib.unzipSync(bytes, {
      filter(file) {
        if (file.originalSize > MAX_ENTRY) return false;
        total += file.originalSize;
        if (total > MAX_TOTAL) throw new Error('Arquivo demasiado grande');
        return true;
      }
    });
  }

  function zip(parts) {
    const out = {};
    for (const [name, data] of Object.entries(parts)) out[name] = typeof data === 'string' ? encoder.encode(data) : data;
    return zipLib.zipSync(out, { level: 6 });
  }

  function parseXML(files, name) {
    if (!files[name]) return null;
    const doc = new DOMParser().parseFromString(decoder.decode(files[name]), 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  }

  // Os prefixos dos espaços de nomes variam entre programas; procura-se sempre pelo nome local.
  const all = (node, name) => (node ? [...node.getElementsByTagNameNS('*', name)] : []);
  const first = (node, name) => (node ? node.getElementsByTagNameNS('*', name)[0] || null : null);
  const kids = (node, name) => (node ? [...node.children].filter((c) => !name || c.localName === name) : []);
  const kid = (node, name) => kids(node, name)[0] || null;
  function attr(node, name) {
    if (!node) return null;
    for (const a of node.attributes) if (a.localName === name) return a.value;
    return null;
  }

  // r:id — o identificador de relação, que não se confunde com um atributo "id" sem prefixo.
  function relAttr(node) {
    if (!node) return null;
    for (const a of node.attributes) if (a.localName === 'id' && (a.namespaceURI || '').includes('relationships')) return a.value;
    return null;
  }

  const esc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const html = MO.escapeHTML;

  // Relações de uma parte: id -> caminho absoluto dentro do arquivo (ou URL externo).
  function relsOf(files, part) {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const doc = parseXML(files, `${dir}_rels/${part.slice(dir.length)}.rels`);
    const map = {};
    for (const rel of all(doc, 'Relationship')) {
      const target = rel.getAttribute('Target') || '';
      const external = rel.getAttribute('TargetMode') === 'External';
      let path = target;
      if (!external) {
        const stack = target.startsWith('/') ? [] : dir.split('/').filter(Boolean);
        for (const seg of target.split('/')) {
          if (seg === '..') stack.pop();
          else if (seg && seg !== '.') stack.push(seg);
        }
        path = stack.join('/');
      }
      map[rel.getAttribute('Id')] = { path, external, type: (rel.getAttribute('Type') || '').split('/').pop() };
    }
    return map;
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function imageDataURL(files, path) {
    const type = IMAGE_TYPES[(path || '').split('.').pop().toLowerCase()];
    return type && files[path] ? `data:${type};base64,${toBase64(files[path])}` : null;
  }

  // data:image/png;base64,… -> { bytes, ext }
  function imageBytes(dataURL) {
    const m = /^data:image\/(png|jpeg|gif);base64,(.+)$/i.exec(dataURL || '');
    if (!m) return null;
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, ext: m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase() };
  }

  // "rgb(1, 2, 3)" ou "#abc" -> "AABBCC" (sem #), ou null.
  function hexColor(value) {
    if (!value) return null;
    let m = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
    if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(value);
    if (!m || m[4] === '0') return null;
    return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  const fontName = (stack) => (stack || '').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
  const isOn = (node) => Boolean(node) && !['0', 'false', 'none'].includes(attr(node, 'val') || '');

  // =====================================================================
  // DOCX
  // =====================================================================

  const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkYellow: '#808000', lightGray: '#d3d3d3', darkGray: '#a9a9a9' };

  function importDocx(bytes) {
    const files = unzip(bytes);
    const doc = parseXML(files, 'word/document.xml');
    if (!doc) throw new Error('Documento inválido');
    const rels = relsOf(files, 'word/document.xml');

    // Estilos de parágrafo: o Word guarda o nome canónico em inglês ("heading 1") em qualquer idioma.
    const tags = {};
    const styleNum = {}; // listas definidas no estilo do parágrafo ("List Bullet", "List Number")
    const styleList = {};
    for (const style of all(parseXML(files, 'word/styles.xml'), 'style')) {
      const name = (attr(kid(style, 'name'), 'val') || '').toLowerCase();
      const id = attr(style, 'styleId');
      const m = /^heading ([1-6])$/.exec(name);
      if (m) tags[id] = 'h' + Math.min(3, Number(m[1]));
      else if (name === 'title') tags[id] = 'h1';
      else if (name === 'subtitle') tags[id] = 'h2';
      else if (name === 'quote' || name === 'intense quote') tags[id] = 'blockquote';
      const viaStyle = attr(first(first(style, 'numPr'), 'numId'), 'val');
      if (viaStyle) styleNum[id] = viaStyle;
      if (/^list (bullet|number)/.test(name)) styleList[id] = name.startsWith('list number') ? 'ol' : 'ul';
    }

    // Listas: numId -> lista numerada?
    const numbering = parseXML(files, 'word/numbering.xml');
    const abstractOrdered = {};
    for (const abs of all(numbering, 'abstractNum')) {
      const fmt = attr(first(kid(abs, 'lvl'), 'numFmt'), 'val');
      abstractOrdered[attr(abs, 'abstractNumId')] = Boolean(fmt) && fmt !== 'bullet' && fmt !== 'none';
    }
    const ordered = {};
    for (const num of kids(numbering && numbering.documentElement, 'num')) ordered[attr(num, 'numId')] = abstractOrdered[attr(kid(num, 'abstractNumId'), 'val')];

    function runHTML(run) {
      const rPr = kid(run, 'rPr');
      let out = '';
      for (const node of run.children) {
        if (node.localName === 't') out += html(node.textContent);
        else if (node.localName === 'tab') out += '\t';
        else if (node.localName === 'br') out += attr(node, 'type') === 'page' ? '\u0000' : '<br>';
        else if (node.localName === 'drawing' || node.localName === 'pict') {
          const blip = first(node, 'blip');
          const rel = blip && rels[attr(blip, 'embed')];
          const src = rel && imageDataURL(files, rel.path);
          const extent = first(node, 'extent');
          const width = extent ? Math.round(Number(attr(extent, 'cx')) / EMU) : 0;
          if (src) out += `<img src="${src}" alt=""${width > 0 && width < 2000 ? ` style="width: ${width}px"` : ''}>`;
        }
      }
      if (!out || !rPr) return out;
      const styles = [];
      const color = attr(kid(rPr, 'color'), 'val');
      if (color && /^[0-9a-f]{6}$/i.test(color)) styles.push(`color: #${color}`);
      const size = Number(attr(kid(rPr, 'sz'), 'val'));
      if (size > 0 && size < 400) styles.push(`font-size: ${size / 2}pt`);
      const mark = HIGHLIGHT[attr(kid(rPr, 'highlight'), 'val')];
      if (mark) styles.push(`background-color: ${mark}`);
      if (styles.length) out = `<span style="${styles.join('; ')}">${out}</span>`;
      if (isOn(kid(rPr, 'b'))) out = `<b>${out}</b>`;
      if (isOn(kid(rPr, 'i'))) out = `<i>${out}</i>`;
      if (isOn(kid(rPr, 'u'))) out = `<u>${out}</u>`;
      if (isOn(kid(rPr, 'strike'))) out = `<s>${out}</s>`;
      return out;
    }

    function inlineHTML(parent) {
      let out = '';
      for (const node of parent.children) {
        if (node.localName === 'r') out += runHTML(node);
        else if (node.localName === 'hyperlink') {
          const rel = rels[relAttr(node)];
          const inner = inlineHTML(node);
          const href = rel && rel.external && /^(https?:|mailto:)/i.test(rel.path) ? rel.path : null;
          out += href ? `<a href="${html(href)}">${inner}</a>` : inner;
        } else if (['ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(node.localName)) out += inlineHTML(node);
      }
      return out;
    }

    function blocksOf(container) {
      const out = [];
      let list = null;
      const closeList = () => {
        if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
        list = null;
      };
      for (const node of container.children) {
        if (node.localName === 'p') {
          const pPr = kid(node, 'pPr');
          const styleId = attr(kid(pPr, 'pStyle'), 'val');
          const numId = attr(first(kid(pPr, 'numPr'), 'numId'), 'val') || styleNum[styleId] || (styleList[styleId] ? 'style' : null);
          const align = { center: 'center', right: 'right', end: 'right', both: 'justify' }[attr(kid(pPr, 'jc'), 'val')];
          // \u0000 marca uma quebra de página dentro do parágrafo.
          const parts = inlineHTML(node).split('\u0000');
          parts.forEach((part, i) => {
            if (i > 0) {
              closeList();
              out.push('<hr class="page-break">');
            }
            if (numId && numId !== '0') {
              const tag = styleList[styleId] || (ordered[numId] ? 'ol' : 'ul');
              if (!list || list.tag !== tag) {
                closeList();
                list = { tag, items: [] };
              }
              list.items.push(`<li>${part || '<br>'}</li>`);
              return;
            }
            closeList();
            if (i > 0 && !part) return;
            const tag = tags[styleId] || 'p';
            out.push(`<${tag}${align ? ` style="text-align: ${align}"` : ''}>${part || '<br>'}</${tag}>`);
          });
        } else if (node.localName === 'tbl') {
          closeList();
          const rows = kids(node, 'tr').map((tr) => '<tr>' + kids(tr, 'tc').map((tc) => `<td>${kids(tc, 'p').map(inlineHTML).join('<br>') || '<br>'}</td>`).join('') + '</tr>');
          out.push(`<table><tbody>${rows.join('')}</tbody></table>`);
        } else if (node.localName === 'sdt') {
          closeList();
          const content = kid(node, 'sdtContent');
          if (content) out.push(...blocksOf(content));
        }
      }
      closeList();
      return out;
    }

    const body = first(doc, 'body');
    const readSectionText = (kind) => {
      const rel = Object.values(rels).find((item) => item.type === kind && !item.external);
      const part = rel && parseXML(files, rel.path);
      if (!part) return '';
      return all(part, 't').map((node) => node.textContent).join('').slice(0, 250);
    };
    const headerText = readSectionText('header');
    const footerText = readSectionText('footer');
    const footerRel = Object.values(rels).find((item) => item.type === 'footer' && !item.external);
    const footerPart = footerRel && parseXML(files, footerRel.path);
    const pageNumbers = Boolean(footerPart && all(footerPart, 'instrText').some((node) => /\\bPAGE\\b/i.test(node.textContent)));
    return { html: body ? blocksOf(body).join('') : '', headerText, footerText: footerText.replace(/Página\\s*1?$/i, '').replace(/\\s*·\\s*$/, '').trim(), pageNumbers };
  }

  // root: elemento com o conteúdo do documento (o editor); look: tipos de letra e cores do tema.
  function exportDocx(root, look, options = {}) {
    const media = {};
    const rels = [];
    let imageCount = 0;
    const relId = (type, target, external) => {
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return 'rId' + rels.length;
    };

    function runProps(fmt) {
      let out = '';
      if (fmt.b) out += '<w:b/>';
      if (fmt.i) out += '<w:i/>';
      if (fmt.s) out += '<w:strike/>';
      if (fmt.color) out += `<w:color w:val="${fmt.color}"/>`;
      if (fmt.size) out += `<w:sz w:val="${fmt.size}"/><w:szCs w:val="${fmt.size}"/>`;
      if (fmt.u) out += '<w:u w:val="single"/>';
      if (fmt.bg) out += `<w:shd w:val="clear" w:color="auto" w:fill="${fmt.bg}"/>`;
      return out ? `<w:rPr>${out}</w:rPr>` : '';
    }

    function formatOf(el, base) {
      const fmt = { ...base };
      const tag = el.tagName;
      const st = el.style;
      const weight = st.fontWeight;
      if (tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600) fmt.b = true;
      if (weight === 'normal' || weight === '400') fmt.b = false;
      if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') fmt.i = true;
      const deco = st.textDecorationLine || st.textDecoration || '';
      if (tag === 'U' || deco.includes('underline')) fmt.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through')) fmt.s = true;
      const color = hexColor(st.color || (tag === 'FONT' ? el.getAttribute('color') : ''));
      if (color) fmt.color = color;
      const bg = hexColor(st.backgroundColor);
      if (bg) fmt.bg = bg;
      const size = /^([\d.]+)(pt|px)$/.exec(st.fontSize || '');
      if (size) fmt.size = Math.round(Number(size[1]) * (size[2] === 'px' ? 1.5 : 2));
      if (tag === 'A') Object.assign(fmt, { color: fmt.color || '1F5FBF', u: true });
      return fmt;
    }

    function imageRun(img) {
      const data = imageBytes(img.getAttribute('src'));
      if (!data) return '';
      imageCount++;
      const name = `image${imageCount}.${data.ext}`;
      media['word/media/' + name] = data.bytes;
      const id = relId('image', 'media/' + name);
      const natural = { w: img.naturalWidth || 300, h: img.naturalHeight || 200 };
      const width = Math.min(img.clientWidth || natural.w, 620);
      const cx = Math.round(width * EMU);
      const cy = Math.round((width * natural.h) / natural.w) * EMU;
      return (
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageCount}" name="Imagem ${imageCount}"/>` +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageCount}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
      );
    }

    const BLOCKS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'HR'];

    function inline(node, fmt) {
      let out = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const pieces = child.nodeValue.split('\t');
          pieces.forEach((piece, i) => {
            if (i > 0) out += `<w:r>${runProps(fmt)}<w:tab/></w:r>`;
            if (piece) out += `<w:r>${runProps(fmt)}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>`;
          });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') out += '<w:r><w:br/></w:r>';
          else if (child.tagName === 'IMG') out += imageRun(child);
          else if (BLOCKS.includes(child.tagName)) continue; // os blocos aninhados são tratados por blocks()
          else if (child.tagName === 'A' && /^(https?:|mailto:)/i.test(child.getAttribute('href') || '')) {
            out += `<w:hyperlink r:id="${relId('hyperlink', child.getAttribute('href'), true)}">${inline(child, formatOf(child, fmt))}</w:hyperlink>`;
          } else out += inline(child, formatOf(child, fmt));
        }
      }
      return out;
    }

    function paragraph(el, opts) {
      let props = '';
      if (opts.style) props += `<w:pStyle w:val="${opts.style}"/>`;
      if (opts.list) props += `<w:numPr><w:ilvl w:val="${opts.level}"/><w:numId w:val="${opts.list}"/></w:numPr>`;
      const align = { center: 'center', right: 'right', justify: 'both' }[el.style ? el.style.textAlign : ''];
      if (align) props += `<w:jc w:val="${align}"/>`;
      return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inline(el, formatOf(el, {}))}</w:p>`;
    }

    const hasBlocks = (el) => [...el.children].some((c) => BLOCKS.includes(c.tagName));

    function blocks(container, ctx) {
      let out = '';
      let loose = null; // texto solto fora de qualquer bloco
      const flush = () => {
        if (loose && loose.textContent.trim()) out += paragraph(loose, {});
        loose = null;
      };
      for (const node of container.childNodes) {
        const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName : null;
        if (!tag || !BLOCKS.includes(tag)) {
          if (!loose) loose = document.createElement('div');
          loose.append(node.cloneNode(true));
          continue;
        }
        flush();
        if (tag === 'UL' || tag === 'OL') out += blocks(node, { list: tag === 'OL' ? 2 : 1, level: ctx.list ? ctx.level + 1 : 0 });
        else if (tag === 'LI') {
          out += paragraph(node, { list: ctx.list || 1, level: Math.min(ctx.level || 0, 8) });
          if (hasBlocks(node)) out += blocks(node, { list: ctx.list, level: (ctx.level || 0) + 1, nestedOnly: true });
        } else if (tag === 'TABLE') {
          const rows = [...node.rows].map((tr) => '<w:tr>' + [...tr.cells].map((td) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(td, {})}</w:tc>`).join('') + '</w:tr>');
          const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9AA1B1"/>`;
          out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>${rows.join('')}</w:tbl><w:p/>`;
        } else if (tag === 'HR') {
          out += node.classList.contains('page-break')
            ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
            : '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA1B1"/></w:pBdr></w:pPr></w:p>';
        } else if (ctx.nestedOnly) {
          continue;
        } else if (tag === 'DIV' && hasBlocks(node)) {
          out += blocks(node, ctx);
        } else {
          const style = { H1: 'Heading1', H2: 'Heading2', H3: 'Heading3', H4: 'Heading3', H5: 'Heading3', H6: 'Heading3', BLOCKQUOTE: 'Quote' }[tag];
          out += paragraph(node, { style });
        }
      }
      flush();
      return out;
    }

    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const body = blocks(root, {}) || '<w:p/>';
    const headerText = String(options.headerText || '').slice(0, 250);
    const footerText = String(options.footerText || '').slice(0, 250);
    const pageNumbers = Boolean(options.pageNumbers);
    const headerXml = XML_HEAD + `<w:hdr ${W}><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D1D5DB"/></w:pBdr></w:pPr><w:r><w:t xml:space="preserve">${esc(headerText)}</w:t></w:r></w:p></w:hdr>`;
    const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const footerContent = (footerText ? `<w:r><w:t xml:space="preserve">${esc(footerText)}</w:t></w:r>` : '') + (pageNumbers ? `<w:r><w:t xml:space="preserve">${footerText ? ' · Página ' : 'Página '}</w:t></w:r>${pageField}` : '');
    const footerXml = XML_HEAD + `<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="D1D5DB"/></w:pBdr></w:pPr>${footerContent}</w:p></w:ftr>`;
    const hasHeader = Boolean(headerText);
    const hasFooter = Boolean(footerText || pageNumbers);
    const pageRefs = (hasHeader ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : '') + (hasFooter ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : '');
    const pageRelEntries = (hasHeader ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : '') + (hasFooter ? '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '');
    const pageContentTypes = (hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') + (hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '');
    const headFont = esc(fontName(look.head));
    const bodyFont = esc(fontName(look.body));
    const headColor = hexColor(look.color) || '1C2130';
    const heading = (id, name, size, before) =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="160"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="${headFont}" w:hAnsi="${headFont}" w:cs="${headFont}"/><w:b/><w:color w:val="${headColor}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    const level = (i, fmt, text, font) =>
      `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
    const levels = (ordered) => Array.from({ length: 9 }, (_x, i) => (ordered ? level(i, 'decimal', `%${i + 1}.`) : level(i, 'bullet', '•', 'Arial'))).join('');

    return zip({
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' + pageContentTypes + '</Types>',
      '_rels/.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':
        XML_HEAD +
        `<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<w:body>${body}<w:sectPr>${pageRefs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
      'word/styles.xml':
        XML_HEAD +
        `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:cs="${bodyFont}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-PT"/></w:rPr></w:rPrDefault>` +
        '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="340" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        heading('Heading1', 'heading 1', 48, 240) +
        heading('Heading2', 'heading 2', 36, 280) +
        heading('Heading3', 'heading 3', 28, 240) +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="4A5263"/></w:rPr></w:style></w:styles>',
      'word/numbering.xml':
        XML_HEAD +
        `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
      ...(hasHeader ? { 'word/header1.xml': headerXml } : {}),
      ...(hasFooter ? { 'word/footer1.xml': footerXml } : {}),
      'word/_rels/document.xml.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${pageRelEntries}${rels.join('')}</Relationships>`,
      ...media
    });
  }

  // =====================================================================
  // XLSX
  // =====================================================================

  const argb = (value) => (value && /^[0-9a-f]{8}$/i.test(value) ? '#' + value.slice(2).toLowerCase() : value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value.toLowerCase() : null);

  function numberFormat(id, code) {
    if (id === 9 || id === 10) return 'pct';
    if (id === 2 || id === 4) return 'num2';
    if ((id >= 5 && id <= 8) || id === 44 || id === 42) return 'eur';
    if (!code) return null;
    if (code.includes('%')) return 'pct';
    if (/[€$£]|\[\$/.test(code)) return 'eur';
    if (/^[#,0 ]*0\.00$/.test(code)) return 'num2';
    return null;
  }

  // Devolve { cells, clipped }: clipped indica que havia dados fora dos limites da grelha.
  function importXlsx(bytes, rows, cols) {
    const files = unzip(bytes);
    const workbook = parseXML(files, 'xl/workbook.xml');
    if (!workbook) throw new Error('Livro inválido');
    const wbRels = relsOf(files, 'xl/workbook.xml');
    const sheetElements = all(workbook, 'sheet');
    if (!sheetElements.length) throw new Error('O livro não contém folhas');

    const strings = all(parseXML(files, 'xl/sharedStrings.xml'), 'si').map((si) =>
      all(si, 't')
        .filter((t) => t.parentNode.localName !== 'rPh')
        .map((t) => t.textContent)
        .join('')
    );

    // Estilos: cada célula aponta para uma entrada de cellXfs.
    const stylesDoc = parseXML(files, 'xl/styles.xml');
    const customFormats = {};
    for (const nf of all(stylesDoc, 'numFmt')) customFormats[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');
    const fonts = kids(first(stylesDoc, 'fonts'), 'font');
    const fills = kids(first(stylesDoc, 'fills'), 'fill');
    const xfs = kids(first(stylesDoc, 'cellXfs'), 'xf').map((xf) => {
      const s = {};
      const font = fonts[Number(attr(xf, 'fontId'))];
      if (font && isOn(kid(font, 'b'))) s.b = 1;
      if (font && isOn(kid(font, 'i'))) s.i = 1;
      const color = font && argb(attr(kid(font, 'color'), 'rgb'));
      if (color && color !== '#000000') s.c = color;
      const pattern = kid(fills[Number(attr(xf, 'fillId'))], 'patternFill');
      const bg = pattern && attr(pattern, 'patternType') === 'solid' && argb(attr(kid(pattern, 'fgColor'), 'rgb'));
      if (bg) s.bg = bg;
      const align = attr(kid(xf, 'alignment'), 'horizontal');
      if (['left', 'center', 'right'].includes(align)) s.a = align;
      const fmtId = Number(attr(xf, 'numFmtId'));
      const fmt = numberFormat(fmtId, customFormats[fmtId]);
      if (fmt) s.f = fmt;
      return s;
    });

    function readSheet(sheet) {
      if (!sheet) throw new Error('Folha inválida');
      const cells = {};
      let clipped = false;
      for (const c of all(sheet, 'c')) {
        const pos = F.parseAddr(attr(c, 'r') || '');
        if (!pos) continue;
        if (pos.r >= rows || pos.c >= cols) {
          clipped = clipped || Boolean(kid(c, 'v') || kid(c, 'f') || kid(c, 'is'));
          continue;
        }
        const type = attr(c, 't');
        const formula = kid(c, 'f');
        const v = kid(c, 'v');
        let raw = '';
        if (formula && formula.textContent) raw = '=' + formula.textContent;
        else if (type === 's') raw = strings[Number(v && v.textContent)] || '';
        else if (type === 'inlineStr') raw = all(kid(c, 'is'), 't').map((t) => t.textContent).join('');
        else if (type === 'b') raw = v && v.textContent === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (v) raw = v.textContent;
        const isText = !formula && (type === 's' || type === 'inlineStr' || type === 'str');
        if (isText && raw && (raw[0] === '=' || raw[0] === "'" || F.parseNumber(raw) !== null)) raw = "'" + raw;
        const style = xfs[Number(attr(c, 's'))];
        const cell = { v: raw };
        if (style && Object.keys(style).length) cell.s = { ...style };
        if (cell.v !== '' || cell.s) cells[F.addr(pos.r, pos.c)] = cell;
      }
      return { cells, clipped };
    }

    let clipped = false;
    const sheets = sheetElements.map((sheetEl, index) => {
      const rel = wbRels[relAttr(sheetEl)];
      const path = rel ? rel.path : `xl/worksheets/sheet${index + 1}.xml`;
      const result = readSheet(parseXML(files, path));
      clipped = clipped || result.clipped;
      return { name: attr(sheetEl, 'name') || `Folha${index + 1}`, cells: result.cells };
    });
    return { cells: sheets[0].cells, sheets, clipped };
  }

  // cells: modelo da folha; values: Map endereço -> valor calculado.
  // Exporta um livro inteiro. Mantém compatibilidade com a assinatura antiga (cells, values).
  function exportXlsx(input, values) {
    const sheets = Array.isArray(input) && input.length
      ? input.slice(0, 100).map((sheet, i) => ({ name: String(sheet.name || `Folha${i + 1}`).slice(0, 31), cells: sheet.cells || {}, values: sheet.values || (i === 0 ? values : new Map()) }))
      : [{ name: 'Folha1', cells: input || {}, values: values || new Map() }];
    const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const index = (list, item) => (list.includes(item) ? list.indexOf(item) : list.push(item) - 1);
    const NUM_FMT = { num2: 2, pct: 10, eur: 164 };
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

    function styleIndex(s) {
      if (!s) return 0;
      const font = index(fonts, `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}<sz val="11"/>${s.c ? `<color rgb="FF${s.c.slice(1).toUpperCase()}"/>` : ''}<name val="Calibri"/></font>`);
      const fill = s.bg ? index(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.bg.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const fmt = NUM_FMT[s.f] || 0;
      return index(xfs, `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}` + (s.a ? ` applyAlignment="1"><alignment horizontal="${s.a}"/></xf>` : '/>'));
    }

    const parts = {};
    const contentOverrides = sheets.map((_sheet, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const sheetEntries = sheets.map((sheet, i) => `<sheet name="${esc(sheet.name.replace(/[\\\\/?*:[\\]]/g, '').slice(0, 31) || `Folha${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const relEntries = sheets.map((_sheet, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');

    sheets.forEach((sheet, indexSheet) => {
      const byRow = new Map();
      for (const [a, cell] of Object.entries(sheet.cells)) {
        const pos = F.parseAddr(a);
        if (!pos) continue;
        if (!byRow.has(pos.r)) byRow.set(pos.r, []);
        byRow.get(pos.r).push({ a, c: pos.c, cell });
      }
      let rowsXML = '';
      for (const r of [...byRow.keys()].sort((x, y) => x - y)) {
        let row = '';
        for (const { a, cell } of byRow.get(r).sort((x, y) => x.c - y.c)) {
          const style = styleIndex(cell.s);
          const sAttr = style ? ` s="${style}"` : '';
          const raw = cell.v || '';
          const value = sheet.values && sheet.values.get(a);
          const isFormula = raw.length > 1 && raw[0] === '=';
          const formula = isFormula ? `<f>${esc(F.toExcel(raw))}</f>` : '';
          if (raw === '') row += `<c r="${a}"${sAttr}/>`;
          else if (typeof value === 'number') row += `<c r="${a}"${sAttr}>${formula}<v>${value}</v></c>`;
          else if (typeof value === 'boolean') row += `<c r="${a}"${sAttr} t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
          else if (isFormula) row += typeof value === 'string' ? `<c r="${a}"${sAttr} t="str">${formula}<v>${esc(value)}</v></c>` : `<c r="${a}"${sAttr}>${formula}</c>`;
          else row += `<c r="${a}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(value == null ? raw : value))}</t></is></c>`;
        }
        rowsXML += `<row r="${r + 1}">${row}</row>`;
      }
      parts[`xl/worksheets/sheet${indexSheet + 1}.xml`] = XML_HEAD + `<worksheet ${NS}><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="26" width="14" customWidth="1"/></cols><sheetData>${rowsXML}</sheetData></worksheet>`;
    });

    return zip({
      '[Content_Types].xml': XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + contentOverrides +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': XML_HEAD + `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
      'xl/_rels/workbook.xml.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntries +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': XML_HEAD + `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>` +
        `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills>` +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      ...parts
    });
  }

  // =====================================================================
  // PPTX
  // =====================================================================

  const STAGE = { w: 960, h: 540 };
  const PH_DEFAULT = {
    ctrTitle: { x: 80, y: 170, w: 800, h: 110, fs: 54 },
    subTitle: { x: 80, y: 300, w: 800, h: 60, fs: 28 },
    title: { x: 60, y: 40, w: 840, h: 80, fs: 40 },
    body: { x: 60, y: 140, w: 840, h: 340, fs: 28 }
  };

  function importPptx(bytes) {
    const files = unzip(bytes);
    const pres = parseXML(files, 'ppt/presentation.xml');
    if (!pres) throw new Error('Apresentação inválida');
    const presRels = relsOf(files, 'ppt/presentation.xml');
    const size = first(pres, 'sldSz');
    const cx = Number(attr(size, 'cx')) || 9144000;
    const cy = Number(attr(size, 'cy')) || 5143500;
    // Ajusta o diapositivo à área 960 × 540, centrando quando a proporção é diferente (por exemplo 4:3).
    const k = Math.min(STAGE.w / cx, STAGE.h / cy);
    const dx = (STAGE.w - cx * k) / 2;
    const dy = (STAGE.h - cy * k) / 2;
    const ptToPx = k * 12700; // 1 pt = 12700 EMU

    const boxOf = (xfrm) => {
      const off = kid(xfrm, 'off');
      const ext = kid(xfrm, 'ext');
      if (!off || !ext) return null;
      return { x: Math.round(Number(attr(off, 'x')) * k + dx), y: Math.round(Number(attr(off, 'y')) * k + dy), w: Math.round(Number(attr(ext, 'cx')) * k), h: Math.round(Number(attr(ext, 'cy')) * k) };
    };
    const solid = (node) => {
      const fill = kid(node, 'solidFill');
      const value = attr(kid(fill, 'srgbClr'), 'val');
      return value && /^[0-9a-f]{6}$/i.test(value) ? '#' + value.toLowerCase() : null;
    };

    // Posição de um marcador de posição herdada do esquema ou do modelo global.
    function inheritedBox(doc, type, idx) {
      for (const sp of all(doc, 'sp')) {
        const ph = first(kid(sp, 'nvSpPr'), 'ph');
        if (!ph) continue;
        const sameType = (attr(ph, 'type') || 'body') === type;
        if ((idx && attr(ph, 'idx') === idx) || (!idx && sameType) || (sameType && type !== 'body')) {
          const box = boxOf(first(kid(sp, 'spPr'), 'xfrm'));
          if (box) return box;
        }
      }
      return null;
    }

    function paragraphs(txBody, defaults) {
      const paras = kids(txBody, 'p');
      let size = null;
      let color = null;
      let bold = null;
      let italic = null;
      let align = null;
      let bulleted = false;
      const lines = paras.map((p) => {
        const pPr = kid(p, 'pPr');
        if (!align) align = { ctr: 'center', r: 'right' }[attr(pPr, 'algn')] || null;
        if (pPr && (kid(pPr, 'buChar') || kid(pPr, 'buAutoNum'))) bulleted = true;
        let out = '';
        for (const node of p.children) {
          if (node.localName === 'br') out += '<br>';
          if (node.localName !== 'r' && node.localName !== 'fld') continue;
          const rPr = kid(node, 'rPr');
          const text = html(first(node, 't') ? first(node, 't').textContent : '');
          if (!text) continue;
          const b = attr(rPr, 'b') === '1';
          const i = attr(rPr, 'i') === '1';
          if (size === null && attr(rPr, 'sz')) size = Number(attr(rPr, 'sz')) / 100;
          if (color === null) color = rPr ? solid(rPr) : null;
          if (bold === null) bold = b;
          if (italic === null) italic = i;
          out += (b && !defaults.bold ? `<b>${text}</b>` : text).replace(/^(.*)$/s, i ? '<i>$1</i>' : '$1');
        }
        return { text: out, noBullet: Boolean(pPr && kid(pPr, 'buNone')) };
      });
      const filled = lines.filter((l) => l.text);
      if (!filled.length) return null;
      const asList = (defaults.list || bulleted) && !filled.every((l) => l.noBullet);
      return {
        html: asList ? '<ul>' + filled.map((l) => `<li>${l.text}</li>`).join('') + '</ul>' : filled.map((l) => l.text).join('<br>'),
        fs: Math.max(8, Math.min(200, Math.round(size ? size * ptToPx : defaults.fs))),
        color,
        align,
        italic: Boolean(italic) && filled.length === 1
      };
    }

    const slides = [];
    for (const sldId of all(first(pres, 'sldIdLst'), 'sldId')) {
      const rel = presRels[relAttr(sldId)];
      const doc = rel && parseXML(files, rel.path);
      if (!doc) continue;
      const rels = relsOf(files, rel.path);
      const layoutRel = Object.values(rels).find((r) => r.type === 'slideLayout');
      const layout = layoutRel && parseXML(files, layoutRel.path);
      const masterRel = layoutRel && Object.values(relsOf(files, layoutRel.path)).find((r) => r.type === 'slideMaster');
      const master = masterRel && parseXML(files, masterRel.path);
      const els = [];

      const visit = (tree) => {
        for (const node of kids(tree)) {
          if (node.localName === 'grpSp') visit(node);
          else if (node.localName === 'pic') {
            const blipRel = rels[attr(first(node, 'blip'), 'embed')];
            const src = blipRel && imageDataURL(files, blipRel.path);
            const box = boxOf(first(kid(node, 'spPr'), 'xfrm'));
            if (src && box) els.push({ type: 'image', src, ...box });
          } else if (node.localName === 'sp') {
            const ph = first(kid(node, 'nvSpPr'), 'ph');
            const type = ph ? attr(ph, 'type') || 'body' : null;
            if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) continue;
            const spPr = kid(node, 'spPr');
            const preset = ph ? PH_DEFAULT[type] || PH_DEFAULT.body : null;
            const box =
              boxOf(first(spPr, 'xfrm')) ||
              (ph && (inheritedBox(layout, type, attr(ph, 'idx')) || inheritedBox(master, type, attr(ph, 'idx')))) ||
              (preset && { x: preset.x, y: preset.y, w: preset.w, h: preset.h });
            if (!box) continue;
            const fill = solid(spPr);
            const geometry = attr(kid(spPr, 'prstGeom'), 'prst');
            if (fill && !ph) els.push({ type: geometry === 'ellipse' ? 'ellipse' : 'rect', fill, ...box });
            const isTitle = type === 'title' || type === 'ctrTitle';
            const text = paragraphs(kid(node, 'txBody'), { fs: preset ? preset.fs : 24, list: type === 'body', bold: isTitle });
            if (!text) continue;
            const el = { type: 'text', ...box, html: text.html, fs: text.fs, color: text.color || (isTitle ? '#1c2130' : '#3b4252'), align: text.align || (type === 'ctrTitle' || type === 'subTitle' ? 'center' : 'left') };
            if (isTitle) Object.assign(el, { bold: true, role: 'title' });
            else if (ph) el.role = 'body';
            if (text.italic) el.italic = true;
            els.push(el);
          }
        }
      };
      visit(first(doc, 'spTree'));

      const slide = { bg: solid(first(kid(first(doc, 'cSld'), 'bg'), 'bgPr')) || '#ffffff', els, notes: '' };
      const notesRel = Object.values(rels).find((r) => r.type === 'notesSlide');
      const notes = notesRel && parseXML(files, notesRel.path);
      for (const sp of all(notes, 'sp')) {
        if (attr(first(kid(sp, 'nvSpPr'), 'ph'), 'type') !== 'body') continue;
        slide.notes = kids(kid(sp, 'txBody'), 'p')
          .map((p) => all(p, 't').map((t) => t.textContent).join(''))
          .join('\n')
          .trim();
      }
      slides.push(slide);
    }
    if (!slides.length) throw new Error('Sem diapositivos');
    return slides;
  }

  // slides: modelo dos Diapositivos; fonts: mapa chave -> família de tipos de letra.
  function exportPptx(slides, fonts) {
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const parts = {};
    let mediaCount = 0;
    const emu = (px) => Math.round(px * EMU);
    const xfrm = (el) => `<a:xfrm><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(el.w)}" cy="${emu(el.h)}"/></a:xfrm>`;
    const fill = (color) => `<a:solidFill><a:srgbClr val="${(hexColor(color) || '000000').toUpperCase()}"/></a:solidFill>`;

    function textBody(el, slide) {
      const face = esc(fontName(fonts[el.role === 'title' && slide.headFont ? slide.headFont : slide.font] || fonts.sans));
      const size = Math.max(100, Math.round(el.fs * 75)); // px -> centésimos de ponto
      const holder = document.createElement('div');
      holder.innerHTML = el.html;

      function runs(node, fmt) {
        let out = '';
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (!child.nodeValue) continue;
            out += `<a:r><a:rPr lang="pt-PT" sz="${size}" b="${fmt.b ? 1 : 0}" i="${fmt.i ? 1 : 0}"${fmt.u ? ' u="sng"' : ''} dirty="0">${fill(el.color)}<a:latin typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${esc(child.nodeValue)}</a:t></a:r>`;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === 'BR') out += '<a:br/>';
            else if (!['UL', 'OL', 'LI', 'P', 'DIV'].includes(child.tagName)) {
              const st = child.style;
              out += runs(child, {
                b: fmt.b || ['B', 'STRONG'].includes(child.tagName) || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600,
                i: fmt.i || ['I', 'EM'].includes(child.tagName) || st.fontStyle === 'italic',
                u: fmt.u || child.tagName === 'U' || (st.textDecorationLine || st.textDecoration || '').includes('underline')
              });
            }
          }
        }
        return out;
      }

      const base = { b: Boolean(el.bold), i: Boolean(el.italic), u: false };
      const algn = { center: 'ctr', right: 'r' }[el.align] || 'l';
      const paras = [];
      const walk = (node, bullet) => {
        let loose = document.createElement('span');
        const flush = () => {
          if (loose.childNodes.length) paras.push({ node: loose, bullet: false });
          loose = document.createElement('span');
        };
        for (const child of [...node.childNodes]) {
          const tag = child.nodeType === Node.ELEMENT_NODE ? child.tagName : '';
          if (tag === 'UL' || tag === 'OL') {
            flush();
            walk(child, true);
          } else if (tag === 'LI') paras.push({ node: child, bullet });
          else if (tag === 'P' || tag === 'DIV') {
            flush();
            paras.push({ node: child, bullet: false });
          } else if (tag === 'BR') flush();
          else loose.append(child.cloneNode(true));
        }
        flush();
      };
      walk(holder, false);
      const body = paras
        .map(({ node, bullet }) => {
          const pPr = bullet
            ? `<a:pPr marL="342900" indent="-342900" algn="${algn}"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>`
            : `<a:pPr marL="0" indent="0" algn="${algn}"><a:buNone/></a:pPr>`;
          return `<a:p>${pPr}${runs(node, base)}</a:p>`;
        })
        .join('');
      return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body || '<a:p/>'}</p:txBody>`;
    }

    slides.forEach((slide, index) => {
      const n = index + 1;
      const rels = [`<Relationship Id="rId1" Type="${REL}slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
      let shapes = '';
      let id = 1;
      for (const el of slide.els) {
        id++;
        if (el.type === 'text') {
          shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Texto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBody(el, slide)}</p:sp>`;
        } else if (el.type === 'image') {
          const data = imageBytes(el.src);
          if (!data) continue;
          mediaCount++;
          const name = `image${mediaCount}.${data.ext}`;
          parts['ppt/media/' + name] = data.bytes;
          rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL}image" Target="../media/${name}"/>`);
          shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Imagem ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${rels.length}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
        } else {
          shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Forma ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${el.type === 'ellipse' ? 'ellipse' : 'rect'}"><a:avLst/></a:prstGeom>${fill(el.fill)}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="pt-PT"/></a:p></p:txBody></p:sp>`;
        }
      }
      parts[`ppt/slides/slide${n}.xml`] =
        XML_HEAD +
        `<p:sld ${A} ${R} ${P}><p:cSld><p:bg><p:bgPr>${fill(slide.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      parts[`ppt/slides/_rels/slide${n}.xml.rels`] = XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
    });

    const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
    const line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
    const scheme = (name, value) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
    const list = slides.map((_s, i) => i + 1);

    return zip({
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
        list.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') +
        '</Types>',
      '_rels/.rels': XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
      'ppt/presentation.xml':
        XML_HEAD +
        `<p:presentation ${A} ${R} ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((n) => `<p:sldId id="${255 + n}" r:id="rId${n + 2}"/>`).join('')}</p:sldIdLst>` +
        '<p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL}theme" Target="theme/theme1.xml"/>` +
        list.map((n) => `<Relationship Id="rId${n + 2}" Type="${REL}slide" Target="slides/slide${n}.xml"/>`).join('') +
        '</Relationships>',
      'ppt/slideMasters/slideMaster1.xml':
        XML_HEAD +
        `<p:sldMaster ${A} ${R} ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>` +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels':
        XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}theme" Target="../theme/theme1.xml"/></Relationships>`,
      'ppt/slideLayouts/slideLayout1.xml': XML_HEAD + `<p:sldLayout ${A} ${R} ${P} type="blank" preserve="1"><p:cSld name="Em branco">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels':
        XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
      'ppt/theme/theme1.xml':
        XML_HEAD +
        `<a:theme ${A} name="Tema"><a:themeElements><a:clrScheme name="Tema">` +
        '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
        scheme('dk2', '1C2130') + scheme('lt2', 'F3F2F1') + scheme('accent1', '1F5FBF') + scheme('accent2', 'C8491F') + scheme('accent3', '7A7F8C') +
        scheme('accent4', 'E0A800') + scheme('accent5', '3B8ED0') + scheme('accent6', '4E9A3A') + scheme('hlink', '1F5FBF') + scheme('folHlink', '7A1F3D') +
        '</a:clrScheme><a:fontScheme name="Tema"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
        '<a:fmtScheme name="Tema"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
        `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
      ...parts
    });
  }

  MO.OOXML = { importDocx, exportDocx, importXlsx, exportXlsx, importPptx, exportPptx };
})();
