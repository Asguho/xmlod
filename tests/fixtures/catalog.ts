/**
 * Shared XML fixtures used across the test suite.
 *
 * @module
 */

export const SINGLE_BOOK_XML = `
<catalog>
  <book id="1">
    <title>Dune</title>
  </book>
  <owner>
    <name>Ada</name>
  </owner>
</catalog>
`;

export const TWO_BOOKS_XML = `
<catalog>
  <book id="1">
    <title>Dune</title>
  </book>
  <book id="2">
    <title>Neuromancer</title>
  </book>
  <owner>
    <name>Ada</name>
  </owner>
</catalog>
`;

export const TWO_OWNERS_XML = `
<catalog>
  <owner><name>Ada</name></owner>
  <owner><name>Grace</name></owner>
</catalog>
`;

export const NESTED_CHAPTERS_XML = `
<library>
  <book>
    <title>Dune</title>
    <chapter><heading>One</heading></chapter>
  </book>
  <book>
    <title>Neuromancer</title>
    <chapter><heading>Uno</heading></chapter>
    <chapter><heading>Dos</heading></chapter>
  </book>
</library>
`;

export const RECURSIVE_SECTIONS_XML = `
<doc>
  <section>
    <title>Top</title>
    <section>
      <title>Nested</title>
      <section>
        <title>Deep</title>
      </section>
    </section>
  </section>
</doc>
`;

export const INVALID_XML = "<catalog><book></catalog>";
