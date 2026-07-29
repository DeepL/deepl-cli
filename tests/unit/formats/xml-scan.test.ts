import {
  findElement,
  replaceElements,
  scanElements,
  type ElementPattern,
} from '../../../src/formats/xml-scan';

const TAG: ElementPattern = {
  open: /<tag(?:\s+id="([^"<]*)")?>/y,
  close: /<\/tag>/y,
};

describe('xml-scan', () => {
  describe('scanElements', () => {
    it('should return elements in document order with their parts split out', () => {
      const elements = scanElements('a<tag id="x">one</tag>b<tag>two</tag>', TAG);

      expect(elements.map((e) => [e.groups[0], e.inner, e.openTag, e.closeTag])).toEqual([
        ['x', 'one', '<tag id="x">', '</tag>'],
        [undefined, 'two', '<tag>', '</tag>'],
      ]);
      expect(elements[0]!.text).toBe('<tag id="x">one</tag>');
    });

    it('should stop at an opening tag that never closes', () => {
      const elements = scanElements('<tag>one</tag><tag>two<tag>three', TAG);

      expect(elements.map((e) => e.inner)).toEqual(['one']);
    });

    it('should skip a closing tag quoted inside a CDATA section', () => {
      const elements = scanElements('<tag><![CDATA[</tag>]]>rest</tag>', TAG);

      expect(elements.map((e) => e.inner)).toEqual(['<![CDATA[</tag>]]>rest']);
    });

    it('should stop at an unterminated CDATA section', () => {
      expect(scanElements('<tag><![CDATA[never ends</tag>', TAG)).toEqual([]);
    });

    it('should ignore a self-closing tag', () => {
      const elements = scanElements('<tag/><tag>one</tag>', TAG);

      expect(elements.map((e) => e.inner)).toEqual(['one']);
    });

    it('should not let an unterminated attribute value match across the next tag', () => {
      const elements = scanElements('<tag id="unterminated<tag>one</tag>', TAG);

      expect(elements.map((e) => e.inner)).toEqual(['one']);
    });
  });

  describe('findElement', () => {
    it('should return the first match', () => {
      expect(findElement('x<tag>one</tag><tag>two</tag>', TAG)?.inner).toBe('one');
    });

    it('should return undefined when there is no match', () => {
      expect(findElement('<other>one</other>', TAG)).toBeUndefined();
    });
  });

  describe('replaceElements', () => {
    it('should return the input unchanged when nothing matches', () => {
      expect(replaceElements('<other>one</other>', TAG, () => 'x')).toBe('<other>one</other>');
    });

    it('should rewrite matched elements in place', () => {
      expect(replaceElements('a<tag>one</tag>b<tag>two</tag>', TAG, (e) => `[${e.inner}]`)).toBe(
        'a[one]b[two]',
      );
    });

    it('should drop an element with its indentation and trailing whitespace', () => {
      const content = 'x\n    <tag>one</tag>\n    <tag>two</tag>\n';

      expect(replaceElements(content, TAG, (e) => (e.inner === 'one' ? null : e.text))).toBe(
        'x\n<tag>two</tag>\n',
      );
    });

    it('should drop consecutive elements without reaching past the previous drop', () => {
      const content = '  <tag>one</tag>  <tag>two</tag>';

      expect(replaceElements(content, TAG, () => null)).toBe('');
    });
  });
});
