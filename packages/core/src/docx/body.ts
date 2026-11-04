/**
 * Walks a WordprocessingML part (document, header, footer, footnotes, endnotes) in order and finds:
 * tracked insertions/deletions, tracked formatting, hidden runs (vanish, white, tiny), field codes
 * with file paths, and the text each comment is attached to.
 */
import { FindingSink, contrast, findFilePath, hexToRgb, usernameFromPath } from '../util.js';
import { type XNode, child, isOn } from './xml.js';

export interface BodyContext {
  part: string;
  /** Style ids whose formatting hides text (w:vanish in styles.xml). */
  hiddenStyles: Set<string>;
  /** The document has a dark page background, so white text is visible. */
  darkBackground: boolean;
}

export interface BodyResult {
  /** Comment id → the text the comment is attached to. */
  anchors: Map<string, string>;
}

type ChangeType = 'ins' | 'del' | 'moveFrom' | 'moveTo';
type HiddenReason = 'vanish' | 'white' | 'tiny';

interface Change {
  type: ChangeType;
  author: string;
  date: string;
}

const WHITE: [number, number, number] = [255, 255, 255];

const CHANGE_TEXT: Record<
  ChangeType,
  { rule: string; severity: 'high' | 'medium' | 'low'; title: (a: string) => string; fix: string }
> = {
  del: {
    rule: 'docx.tracked-deletion',
    severity: 'high',
    title: (a) =>
      `Deleted text is still in the file as a tracked change${a ? ` (deleted by "${a}")` : ''}. Anyone can see it with "Show Markup" or by rejecting the change.`,
    fix: 'Accept or reject all changes (Review → Accept → Accept All Changes), or run `redactguard clean`.',
  },
  ins: {
    rule: 'docx.tracked-insertion',
    severity: 'medium',
    title: (a) =>
      `Text was added as a tracked change that is not accepted yet${a ? ` (added by "${a}")` : ''}. The change history and author name travel with the file.`,
    fix: 'Accept or reject all changes before sharing, or run `redactguard clean`.',
  },
  moveFrom: {
    rule: 'docx.tracked-move',
    severity: 'low',
    title: (a) =>
      `Text was moved as a tracked change${a ? ` by "${a}"` : ''}. Its old position is still recorded.`,
    fix: 'Accept all changes before sharing, or run `redactguard clean`.',
  },
  moveTo: {
    rule: 'docx.tracked-move',
    severity: 'low',
    title: (a) =>
      `Text was moved as a tracked change${a ? ` by "${a}"` : ''}. Its old position is still recorded.`,
    fix: 'Accept all changes before sharing, or run `redactguard clean`.',
  },
};

const HIDDEN_TEXT: Record<HiddenReason, string> = {
  vanish:
    'Text is formatted as hidden. It does not print or show by default, but it is in the file and appears with "Show hidden text".',
  white:
    'Text is white on a white page. You cannot see it, but anyone can select, copy or search it.',
  tiny: 'Text is too small to read (1 pt or less), but it is still in the file.',
};

const HAS_CONTENT = /[\p{L}\p{N}]/u;

export function scanBody(nodes: XNode[], ctx: BodyContext, sink: FindingSink): BodyResult {
  const anchors = new Map<string, string>();
  const openComments = new Set<string>();
  const changes: Change[] = [];
  const formatting = new Map<string, number>();
  const fieldPaths = new Set<string>();

  let change: { key: string; c: Change; text: string; pendingGap: boolean } | null = null;
  let hidden: { reason: HiddenReason; text: string } | null = null;
  let pStyle: string | null = null;
  let pShaded = false;

  const flushChange = () => {
    if (change && HAS_CONTENT.test(change.text)) {
      const t = CHANGE_TEXT[change.c.type];
      sink.add({
        rule: t.rule,
        detector: 'docx-changes',
        severity: t.severity,
        title: t.title(change.c.author),
        evidence: change.text.trim(),
        fix: t.fix,
        details: {
          part: ctx.part,
          author: change.c.author || undefined,
          date: change.c.date || undefined,
        },
      });
    }
    change = null;
  };
  const flushHidden = () => {
    if (hidden && HAS_CONTENT.test(hidden.text)) {
      sink.add({
        rule: `docx.hidden-text.${hidden.reason}`,
        detector: 'docx-hidden-text',
        severity: 'high',
        title: HIDDEN_TEXT[hidden.reason],
        evidence: hidden.text.trim(),
        fix: 'Delete the text (unhiding it first) or run `redactguard clean`, which removes hidden text.',
        details: { part: ctx.part, reason: hidden.reason },
      });
    }
    hidden = null;
  };

  const hiddenReason = (rPr: XNode | undefined): HiddenReason | null => {
    const rStyle = rPr && child(rPr, 'w:rStyle')?.attrs['w:val'];
    if (
      isOn(rPr && child(rPr, 'w:vanish')) ||
      isOn(rPr && child(rPr, 'w:specVanish')) ||
      (rStyle && ctx.hiddenStyles.has(rStyle)) ||
      (pStyle && ctx.hiddenStyles.has(pStyle))
    )
      return 'vanish';
    if (!rPr) return null;
    const sz = Number(child(rPr, 'w:sz')?.attrs['w:val']);
    if (Number.isFinite(sz) && sz > 0 && sz <= 2) return 'tiny';
    const color = child(rPr, 'w:color');
    if (color && !ctx.darkBackground && !pShaded) {
      const highlight = child(rPr, 'w:highlight')?.attrs['w:val'];
      const shd = child(rPr, 'w:shd')?.attrs['w:fill'];
      const hasBg =
        (highlight && highlight !== 'none') || (shd && shd !== 'auto' && !/^f{6}$/i.test(shd));
      const rgb = hexToRgb(color.attrs['w:val'] ?? '');
      const themeWhite = /^(background1|light1)$/i.test(color.attrs['w:themeColor'] ?? '');
      if (!hasBg && ((rgb && contrast(rgb, WHITE) < 1.25) || (themeWhite && !rgb))) return 'white';
    }
    return null;
  };

  const runText = (r: XNode, deleted: boolean): string => {
    let s = '';
    for (const c of r.children) {
      if (c.tag === 'w:t' || (deleted && c.tag === 'w:delText'))
        s += c.children.map((x) => x.text ?? '').join('');
      else if (c.tag === 'w:tab') s += '\t';
      else if (c.tag === 'w:br' || c.tag === 'w:cr') s += '\n';
      else if (c.tag === 'w:noBreakHyphen') s += '-';
      else if (c.tag === 'w:instrText') {
        // Field codes escape backslashes in quoted paths (C:\\\\Users\\\\...).
        const instr = c.children
          .map((x) => x.text ?? '')
          .join('')
          .replace(/\\\\/g, '\\');
        const p = findFilePath(instr);
        if (p) fieldPaths.add(p.replace(/["\\\s]+$/, ''));
      }
    }
    return s;
  };

  const handleRun = (r: XNode) => {
    const rPr = child(r, 'w:rPr');
    const rPrChange = rPr && child(rPr, 'w:rPrChange');
    if (rPrChange) {
      const a = rPrChange.attrs['w:author'] ?? '';
      formatting.set(a, (formatting.get(a) ?? 0) + 1);
    }
    const current = changes[changes.length - 1];
    const deleted = current?.type === 'del' || current?.type === 'moveFrom';
    const text = runText(r, deleted);

    if (text) {
      if (current) {
        const key = `${current.type}|${current.author}`;
        if (change && change.key !== key) flushChange();
        if (!change) change = { key, c: current, text: '', pendingGap: false };
        if (change.pendingGap) change.text += ' … ';
        change.pendingGap = false;
        change.text += text;
      } else if (change && HAS_CONTENT.test(text)) {
        change.pendingGap = true;
      }

      if (!deleted) {
        for (const id of openComments) anchors.set(id, (anchors.get(id) ?? '') + text);
        const reason = hiddenReason(rPr);
        if (reason) {
          if (hidden && hidden.reason !== reason) flushHidden();
          hidden ??= { reason, text: '' };
          hidden.text += text;
        } else if (HAS_CONTENT.test(text)) {
          flushHidden();
        } else if (hidden) {
          hidden.text += text;
        }
      }
    }
    // Text boxes and drawings inside the run can hold whole paragraphs.
    for (const c of r.children) {
      if (c.tag !== 'w:t' && c.tag !== 'w:delText' && c.tag !== 'w:instrText' && c.tag !== 'w:rPr')
        visit(c);
    }
  };

  const visit = (n: XNode): void => {
    switch (n.tag) {
      case 'w:p': {
        const prevStyle = pStyle;
        const prevShaded = pShaded;
        const pPr = child(n, 'w:pPr');
        pStyle = (pPr && child(pPr, 'w:pStyle')?.attrs['w:val']) ?? null;
        const shd = pPr && child(pPr, 'w:shd')?.attrs['w:fill'];
        pShaded = !!shd && shd !== 'auto' && !/^f{6}$/i.test(shd);
        for (const c of n.children) visit(c);
        // Whole changed paragraphs stay together; separate edits in different paragraphs do not.
        if (change?.pendingGap) flushChange();
        else if (change) change.text += '\n';
        if (hidden) hidden.text += '\n';
        pStyle = prevStyle;
        pShaded = prevShaded;
        return;
      }
      case 'w:ins':
      case 'w:del':
      case 'w:moveFrom':
      case 'w:moveTo':
        changes.push({
          type: n.tag.slice(2) as ChangeType,
          author: n.attrs['w:author'] ?? '',
          date: n.attrs['w:date'] ?? '',
        });
        for (const c of n.children) visit(c);
        changes.pop();
        return;
      case 'w:r':
        handleRun(n);
        return;
      case 'w:commentRangeStart':
        if (n.attrs['w:id'] !== undefined) openComments.add(n.attrs['w:id']);
        return;
      case 'w:commentRangeEnd':
        if (n.attrs['w:id'] !== undefined) openComments.delete(n.attrs['w:id']);
        return;
      case 'w:fldSimple': {
        const p = findFilePath(n.attrs['w:instr'] ?? '');
        if (p) fieldPaths.add(p.replace(/["\\]+$/, ''));
        for (const c of n.children) visit(c);
        return;
      }
      case 'mc:AlternateContent': {
        // Choice and Fallback hold the same content twice; read only one.
        const pick = child(n, 'mc:Choice') ?? child(n, 'mc:Fallback');
        if (pick) for (const c of pick.children) visit(c);
        return;
      }
      case 'w:pPr':
      case 'w:sectPr':
        return;
      default:
        for (const c of n.children) visit(c);
    }
  };

  for (const n of nodes) visit(n);
  flushChange();
  flushHidden();

  for (const [author, count] of formatting) {
    sink.add({
      rule: 'docx.tracked-formatting',
      detector: 'docx-changes',
      severity: 'low',
      title: `Formatting changes are tracked${author ? ` and name their author ("${author}")` : ''}.`,
      evidence: `${count} tracked formatting change${count > 1 ? 's' : ''} in ${ctx.part}`,
      fix: 'Accept all changes before sharing, or run `redactguard clean`.',
      details: { part: ctx.part, author: author || undefined, count },
    });
  }
  for (const p of fieldPaths) {
    const user = usernameFromPath(p);
    sink.add({
      rule: 'docx.file-path',
      detector: 'docx-metadata',
      severity: 'medium',
      title: `A field code in the document points to a file on the computer it was made on${user ? `, which reveals the username "${user}"` : ''}.`,
      evidence: p,
      fix: 'Unlink fields (select all, Ctrl+Shift+F9) or run `redactguard clean`.',
      details: { part: ctx.part, source: 'field code' },
    });
  }
  return { anchors };
}
