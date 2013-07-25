# Public Registry Scraper

Public Registry Scraper includes rake tasks to scrape and do a bit of parsing on the disclosures of Members of Parliament
from the Office of the Conflict of Interest and Ethics Commissioner (http://ciec-ccie.gc.ca), revealing connections
between MPs and organizations and businesses.  A D3-based javascript visualization displays this data.

## Installation

Download the git repo, then:

   bundle install

## Usage

To re-run the data scrape (generating *data/mp_disclosures.yaml*):

    rake public_registry:scrape

To re-run the parsing of organizations and businesses in the disclosure text (generating *data/processed_data.yaml* and
*www/processed_data.json):

   rake public_registry:mine

To view the visualization, open www/index.html in your browser.  Chrome or Safari recommended.

## Licence and Credits

(c) 2012-2013, Kent Mewhort, licensed under BSD. See LICENSE.txt for details.

Thanks to Mike Bostock for the (D3 libraries)[http://d3js.org/] used in the visualization and (Open North)[http://www.opennorth.ca]
for the (Represent API)[http://represent.opennorth.ca/], used to retrieve further data on MPs.