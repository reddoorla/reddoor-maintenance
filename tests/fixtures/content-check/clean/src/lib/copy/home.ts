// The home page's wording as the code keeps it, behind the home document's
// fields (the pattern MSOT moved 319 fields into Prismic with, P1-103).
import { text } from "../content";

export const HOME_COPY = {
  heading: "Homes built to last",
  subheading: "Since 1998, in the valley",
};

export function homeCopy(doc: { data?: { heading?: string | null; subheading?: string | null } } | null) {
  const d = doc?.data;
  return {
    heading: text(d?.heading, HOME_COPY.heading),
    subheading: text(d?.subheading, HOME_COPY.subheading),
  };
}
