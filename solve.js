// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly
// {columns, rows, errors} for {text, header}, with the same broken-row
// policy (BOM dropped, LF/CRLF record ends, stray CRs dropped with an
// error, quoted fields with "" escapes and LF-normalised line breaks
// inside, junk after a closing quote, unterminated quotes re-read as
// unquoted, short/long row padding and cutting). Pure and deterministic.
//
// Speed comes from bulk scanning instead of reading one character at a
// time. A record is parsed inside its own line wherever possible: an
// unquoted field costs one indexOf(',') plus one slice, a quoted field
// one indexOf('"') plus one slice, and a single indexOf('\r') per line
// settles every stray-CR question at once. A quoted field that does not
// close on its line falls back to a general multi-line scanner, and a
// quote-free line is split on commas directly. Error objects are only
// built when an error actually happens.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;
  // How the last field read by the general scanner ended: 0 comma,
  // 1 line break, 2 end of text.
  let lastEnded = 2;
  // Characters kept by the last general unquoted read beyond its value.
  let lastAdded = 0;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Count the line breaks inside text[a, b): every LF, plus every CR not
  // followed by LF (a CRLF counts once, through its LF).
  function countBreaks(a, b) {
    let count = 0;
    let i = a;
    for (;;) {
      const j = text.indexOf('\n', i);
      if (j === -1 || j >= b) break;
      count += 1;
      i = j + 1;
    }
    i = a;
    for (;;) {
      const j = text.indexOf('\r', i);
      if (j === -1 || j >= b) break;
      if (text.charCodeAt(j + 1) !== 10) count += 1;
      i = j + 1;
    }
    return count;
  }

  // Strip lone CRs from s (every CR in s is stray), one error each.
  function stripCRs(s) {
    let out = '';
    let st = 0;
    let k = s.indexOf('\r');
    while (k !== -1) {
      err('stray_cr');
      out += s.slice(st, k);
      st = k + 1;
      k = s.indexOf('\r', st);
    }
    out += s.slice(st);
    return out;
  }

  // Read an unquoted field starting at p with the value v0 already kept
  // ("" for a fresh field, the opening quote for an unterminated quoted
  // field re-read as unquoted, or a closed quoted field's value when
  // reading the junk after its closing quote). Returns the field and sets
  // lastEnded / lastAdded (chars kept beyond v0).
  function unquoted(v0, p) {
    let value = v0;
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', p);
      const ni = text.indexOf('\n', p);
      const ri = text.indexOf('\r', p);
      let m = ci;
      let kind = 0;
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 1; }
      if (ri !== -1 && (m === -1 || ri < m)) { m = ri; kind = 2; }
      if (m === -1) {
        if (p < n) { value += text.slice(p); added += n - p; }
        pos = n;
        lastAdded = added;
        lastEnded = 2;
        return value;
      }
      if (kind === 0) {
        if (m > p) { value += text.slice(p, m); added += m - p; }
        pos = m + 1;
        lastAdded = added;
        lastEnded = 0;
        return value;
      }
      if (kind === 1) {
        if (m > p) { value += text.slice(p, m); added += m - p; }
        pos = m + 1;
        line += 1;
        lastAdded = added;
        lastEnded = 1;
        return value;
      }
      // A CR: a CRLF ends the record, a lone CR is dropped with an error.
      if (text.charCodeAt(m + 1) === 10) {
        if (m > p) { value += text.slice(p, m); added += m - p; }
        pos = m + 2;
        line += 1;
        lastAdded = added;
        lastEnded = 1;
        return value;
      }
      if (m > p) { value += text.slice(p, m); added += m - p; }
      err('stray_cr');
      p = m + 1;
    }
  }

  // Read a quoted field whose opening quote is at pos. Returns the field
  // and sets lastEnded / lastAdded like unquoted does.
  function quoted() {
    const open = pos;
    const openLine = line;
    let segStart = pos + 1;
    let q = pos + 1;
    let parts = null;
    let close = -1;
    for (;;) {
      const c = text.indexOf('"', q);
      if (c === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        line = openLine;
        err('unterminated_quote');
        return unquoted('"', open + 1);
      }
      if (text.charCodeAt(c + 1) === 34) {
        // A doubled quote: one quote kept, scanning resumes after the pair.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, c) + '"');
        segStart = c + 2;
        q = c + 2;
        continue;
      }
      close = c;
      break;
    }
    let value = parts === null
      ? text.slice(segStart, close)
      : parts.join('') + text.slice(segStart, close);
    // Line breaks inside the quotes read as LF, and each one moves the
    // line on. Only looked for when the span can hold one.
    const ni = text.indexOf('\n', open + 1);
    const ri = text.indexOf('\r', open + 1);
    if ((ni !== -1 && ni < close) || (ri !== -1 && ri < close)) {
      line += countBreaks(open + 1, close);
      value = value.replace(/\r\n?/g, '\n');
    }
    pos = close + 1;
    if (pos >= n) { lastAdded = 0; lastEnded = 2; return value; }
    const ch = text.charCodeAt(pos);
    if (ch === 44) { pos += 1; lastAdded = 0; lastEnded = 0; return value; }
    if (ch === 10) { pos += 1; line += 1; lastAdded = 0; lastEnded = 1; return value; }
    if (ch === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; lastAdded = 0; lastEnded = 1; return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = unquoted(value, pos);
    if (lastAdded > 0) err('quote_junk');
    return junk;
  }

  function finishRecord(fields, quotedFlag) {
    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedFlag) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; return; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Move past the end of the line whose LF is lf (-1: end of text).
  function endLine(lf) {
    if (lf === -1) { pos = n; return; }
    pos = lf + 1;
    line += 1;
  }

  // Parse a record whose first line (LF lf, content up to cEnd) holds a
  // quote. lineCR: the line content holds a stray CR. Returns -1 when a
  // quoted field runs past the line (pos reset to that field's start,
  // fields kept: finish with the general scanner), else 1 when the last
  // field read was quoted, 0 when it was not.
  function lineRecord(fields, lf, cEnd, lineCR) {
    let p = pos;
    for (;;) {
      if (text.charCodeAt(p) === 34) {
        let segStart = p + 1;
        let q = p + 1;
        let parts = null;
        let close = -1;
        for (;;) {
          const c = text.indexOf('"', q);
          if (c === -1 || c >= cEnd) { pos = p; return -1; }
          if (text.charCodeAt(c + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, c) + '"');
            segStart = c + 2;
            q = c + 2;
            continue;
          }
          close = c;
          break;
        }
        let value = parts === null
          ? text.slice(segStart, close)
          : parts.join('') + text.slice(segStart, close);
        if (lineCR && value.indexOf('\r') !== -1) {
          line += countBreaks(p + 1, close);
          value = value.replace(/\r\n?/g, '\n');
        }
        const np = close + 1;
        if (np >= cEnd) { fields.push(value); endLine(lf); return 1; }
        if (text.charCodeAt(np) === 44) { fields.push(value); p = np + 1; continue; }
        // Junk after the closing quote, up to the next comma or line end.
        const ci = text.indexOf(',', np);
        const jEnd = ci !== -1 && ci < cEnd ? ci : cEnd;
        let junk = text.slice(np, jEnd);
        if (lineCR && junk.indexOf('\r') !== -1) junk = stripCRs(junk);
        if (junk.length > 0) err('quote_junk');
        fields.push(value + junk);
        if (jEnd === cEnd) { endLine(lf); return 1; }
        p = jEnd + 1;
        continue;
      }
      const ci = text.indexOf(',', p);
      const fEnd = ci !== -1 && ci < cEnd ? ci : cEnd;
      let v = text.slice(p, fEnd);
      if (lineCR && v.indexOf('\r') !== -1) v = stripCRs(v);
      fields.push(v);
      if (fEnd === cEnd) { endLine(lf); return 0; }
      p = fEnd + 1;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    const qpos = text.indexOf('"', pos);
    const cEnd = lf !== -1 && lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13
      ? lineEnd - 1 : lineEnd;

    if (qpos === -1 || qpos >= lineEnd) {
      // Quote-free line: split it on commas.
      const fields = [];
      const r0 = text.indexOf('\r', pos);
      if (r0 === -1 || r0 >= cEnd) {
        let f = pos;
        for (;;) {
          const c = text.indexOf(',', f);
          if (c === -1 || c >= cEnd) { fields.push(text.slice(f, cEnd)); break; }
          fields.push(text.slice(f, c));
          f = c + 1;
        }
      } else {
        let f = pos;
        for (;;) {
          const c = text.indexOf(',', f);
          const fEnd = c === -1 || c >= cEnd ? cEnd : c;
          let v = text.slice(f, fEnd);
          if (v.indexOf('\r') !== -1) v = stripCRs(v);
          fields.push(v);
          if (fEnd === cEnd) break;
          f = c + 1;
        }
      }
      endLine(lf);
      finishRecord(fields, false);
      continue;
    }

    const r0 = text.indexOf('\r', pos);
    const lineCR = r0 !== -1 && r0 < cEnd;
    const fields = [];
    const done = lineRecord(fields, lf, cEnd, lineCR);
    if (done !== -1) { finishRecord(fields, done === 1); continue; }
    // A quoted field runs past its line: finish the record with the
    // general scanner (multi-line quoted fields, unterminated quotes).
    let quotedFlag = false;
    do {
      let v;
      if (text.charCodeAt(pos) === 34) { quotedFlag = true; v = quoted(); }
      else { quotedFlag = false; v = unquoted('', pos); }
      fields.push(v);
    } while (lastEnded === 0);
    finishRecord(fields, quotedFlag);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
