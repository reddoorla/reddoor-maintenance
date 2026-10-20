import { describe, it, expect } from "vitest";
import { canonical } from "../_helpers/parity.js";

/**
 * The parity harness, proven on inputs whose answer is known (review round 1 of
 * #582 step 1a found it blind to a lost space inside an inline element). Each
 * pair either renders the same in a browser or does not.
 */

const same = (a: string, b: string) => expect(canonical(a)).toEqual(canonical(b));
const differ = (a: string, b: string) => expect(canonical(a)).not.toEqual(canonical(b));

describe("the parity harness", () => {
  it("forgives what a browser does not render", () => {
    same("<div>\n  <p>a</p>\n  <p>b</p>\n</div>", "<div><p>a</p><p>b</p></div>");
    same("<table><tr>\n<td>x</td>\n</tr></table>", "<table><tr><td>x</td></tr></table>");
    same("<span>x </span> y", "<span>x</span> y");
    same('<span class="c">\n  <b>a</b>\n</span>', '<span class="c"><b>a</b></span>');
    same(
      "<select>\n<option>a</option>\n<option>b</option></select>",
      "<select><option>a</option><option>b</option></select>",
    );
    same("<p>a<!--[-->  <!--]--> b</p>", "<p>a b</p>");
    same("<a title=&quot;x&quot;>y</a>".replace(/&quot;/g, '"'), "<a title='x'>y</a>");
    same("<p>it&#39;s</p>", "<p>it's</p>");
  });

  it("sees what a browser renders", () => {
    differ("<h2>(30)<span> — showing</span></h2>", "<h2>(30)<span>— showing</span></h2>");
    differ("<a>x</a> <label>y</label>", "<a>x</a><label>y</label>");
    differ("<textarea>a\n\n  b</textarea>", "<textarea>a b</textarea>");
    differ('<div class="subm-msg">a\n\n\nb</div>', '<div class="subm-msg">a b</div>');
    differ("<p>a&nbsp;b</p>", "<p>a b</p>");
    differ("<p>a b</p>", "<p>a b</p>");
    differ('<button disabled="">x</button>', "<button>x</button>");
    differ("<b>a</b> <i>b</i>", "<b>a</b><i>b</i>");
    differ('<a href="/x">y</a>', '<a href="/z">y</a>');
  });
});
