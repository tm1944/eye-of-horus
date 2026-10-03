# Global events globe. Business model and hackathon brief

Operator constraint. The team has free Google API access and free Snowflake API access. Do not drop Snowflake or Google Maps or Gemini to save money. Challenge those vendors only when they hurt weekend speed, live-demo reliability, licensing, or product quality.

Later paid path. When credits end, keep the same event schema and move the warehouse bill and the Google Maps or Gemini bill onto a paid project. Do not redesign the product around cost.

## 1. Comparable products

### Open event machines

**GDELT Project.** The official project says released datasets are free for academic, commercial, and government use with no fee. ([About GDELT](https://gdeltproject.org/about.html), [GDELT data](https://gdeltproject.org/data.html).) Buyers are researchers and builders who can handle huge CSVs or BigQuery. What they miss is a trustworthy product UI, human verification, and a license that is simple for a SaaS reseller.

**GDELT Cloud.** This is a separate commercial product. Explore is a 7-day trial then 50 query units per month. Builder is $49 per month. Team is $124 per month. Analyst is $333 per month. Intelligence is $749 per month. Academic and research access can be free after verification. Data is hourly, not streamed. Median lag is claimed at about 40 minutes. ([GDELT Cloud pricing](https://gdeltcloud.com/pricing).) Terms allow internal and product use. They forbid resale, republishing, mirroring, or serving Cloud events as a substitute feed without a written redistribution or OEM license. ([GDELT Cloud terms](https://gdeltcloud.com/terms), [acceptable use](https://gdeltcloud.com/acceptable-use).) What they miss for a student demo is easy public redistribution and true live streaming.

**ACLED.** Conflict and protest events with a human coding method. Public tiers exist. Commercial users need a corporate license. Government and multilateral users need a public-sector license. List price is confidential. ([myACLED FAQ](https://acleddata.com/myacled-faqs), [ACLED EULA](https://acleddata.com/eula).) Older public FAQs said corporate users got three free downloads a year and that for-profit use always needs a license. ([2023 access FAQ PDF](https://acleddata.com/sites/default/files/wp-content-archive/uploads/2023/07/ACLED_Terms-of-Use-Attribution-Access_FAQs_2023.pdf).) Canada’s Department of National Defence awarded a 12-month OSINT GlobalConflictData subscription to ACLED Analysis Incorporated for 26 Oct 2025 to 25 Oct 2026. ([CanadaBuys contract history](https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2418650-001).) The official page did not expose a dollar amount in this research. A third-party awards index reports $355.7K. Treat that figure as unverified until someone opens the award on CanadaBuys. ([Proposal Forge vendor page](https://proposalforge.io/canadian-awards/vendor/acled-analysis-incorporated).) What they miss is non-conflict hazards and a consumer globe.

**ReliefWeb.** UN OCHA humanitarian reports, jobs, and training. The API is free and needs no key. Partner content can be copyrighted. ReliefWeb tells users to respect the original source. ([ReliefWeb API docs](https://apidoc.reliefweb.int/), [ReliefWeb API help](https://reliefweb.int/help/api).) Buyers are aid agencies and journalists. What they miss is a live multi-hazard map and structured causality.

**USGS earthquakes.** Scientific data are public-domain federal records except where security or privacy blocks release. ([USGS data release FAQ](https://www.usgs.gov/faqs/what-usgs-policy-release-scientific-data-are-any-usgs-products-restricted), [copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits).) Real-time GeoJSON and other feeds are free. ([USGS feeds](https://earthquake.usgs.gov/earthquakes/feed/).) What they miss is everything that is not seismology.

**NASA FIRMS.** Near-real-time fire hotspots. NASA promotes open sharing and asks for a “NASA FIRMS” citation. A free MAP_KEY is required. Usage is limited in a 10-minute window. ([FIRMS FAQ](https://www.earthdata.nasa.gov/data/tools/firms/faq), [FIRMS API key notes](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html).) What they miss is confirmation that a hotspot is a wildfire versus industry flare, and any political layer.

### Consumer and OSINT maps

**Liveuamap.** Ad-supported consumer map plus PRO and API. About page says ads are the main revenue. PRO is listed from about $7 per month or $9.54 per half-year on the account page. API is $150 per month for 200 requests per day. Enterprise API starts at $1000 per month for 1500 requests per day. ([About](https://liveuamap.com/site/about/), [API promo](https://liveuamap.com/promo/api), [account compare](https://me.liveuamap.com/welcome).) Buyers are curious readers, some enterprises, and integrators. What they miss is verified science layers and a defensible causal graph.

**Google Crisis Map.** Standalone site shut down in 2021. Hazard layers moved toward Search and Maps SOS Alerts. Source repo is archived. ([9to5Google](https://9to5google.com/2021/02/17/google-crisis-map/), [archived repo](https://github.com/google/googlecrisismap).) There is no current Crisis Map product to undercut.

### Paid risk platforms

**Dataminr.** Real-time event detection from public signals. AWS Marketplace lists First Alert at $30,000 per user per 12 months. Pulse team SKUs are listed at $65,000 per 12 months per risk team. ([First Alert listing](https://aws.amazon.com/marketplace/pp/prodview-7eav2xsxvnupy), [Pulse listing](https://aws.amazon.com/marketplace/pp/prodview-3tflfnrcskima).) A Forrester TEI composite used about $100,000 to $110,000 per year for a growing First Alert seat count. ([Forrester TEI](https://tei.forrester.com/go/dataminr/FirstAlert/).) A UK public contract showed £15,000 for a 12-month First Alert license in 2023 to 2024. Treat AWS list and one public SOW as different deal shapes, not one true price. ([UK Contracts Finder attachment](https://www.contractsfinder.service.gov.uk/Notice/Attachment/587991b8-7989-4e34-b296-964e1496716d).) Dataminr claims more than 100 U.S. public-sector agencies, two-thirds of the Fortune 50, and half of the Fortune 100. That is a vendor claim. ([Dataminr and Crisis24 press note](https://www.dataminr.com/press/announcement/dataminr-crisis24-strategic-partnership/).) What they miss for a student team is any chance to out-collect them.

**Crisis24.** Duty-of-care, travel risk, mass notification, and analyst reporting. Horizon list price is unknown. A Ukraine conflict report subscription is $2,490 per week. AWS lists Crisis24 Mass Notification at $50,000 per 12 months plus extra messaging units. Purchases go through private offer. ([Ukraine report page](https://crisis24.garda.com/detailed-ukraine-risk-intelligence-reports), [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-fzt42v6ok5yam).) Buyers are corporate security and HR. What they miss is a cheap self-serve globe. Their edge is humans plus employee location, not a heatmap.

**Predata.** FiscalNote-owned alternative-data risk product. Clients are described as finance, business, and government. Public list price is unknown. ([What is Predata](https://predata.com/block/what-is-predata/).)

**Recorded Future.** Not in the original list. Useful price anchor. AWS lists Geopolitical Intel at $281,250 per 36 months for up to 2 users. ([AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-e2ttyopt6btwa).)

**Maxar.** Satellite imagery and Earth intelligence. MGP Pro is sold as a consumption or seat subscription. Public dollar price is unknown. ([PacGeo MGP brochure](https://pacgeo.com/wp-content/uploads/2025/03/Maxar-Geospatial-Platform-PacGeo.pdf).) Buyers are defense, insurance, and energy. What they miss is cheap news fusion. Imagery is the moat.

**Common miss across all of them.** No one offers a student-simple globe that fuses open sensor events with a small, source-linked relation graph and an honest “unknown” state. Heatmaps of headlines are already a crowded commodity.

## 2. Real buyer versus weekend proof

A real company sells to a budget owner with a duty.

Typical buyers:

- Government and intel shops that already pay ACLED-class subscriptions.
- Corporate security and travel-risk teams that buy Crisis24 or Dataminr.
- Insurers and reinsurers that need hazard footprints, not news vibes. Guess. Named insurer ACV was not found.
- Commodity and macro desks that pay for geopolitical modules. Recorded Future’s listed geo module is the public proxy.
- NGOs that already live in ReliefWeb and ACLED.

They buy recall on the events that matter, auditability, SLAs, and a path into their stack. They do not buy a pretty globe.

A 1 to 2 day hackathon must prove four things only.

1. Live layers from at least two open sensor feeds plus one political or news cluster.
2. Toggles that change the map in under a second.
3. One relation card that a judge can check against sources.
4. A sentence on who would pay and why this is not Liveuamap.

Do not prove Snowflake scale. Do not prove a full news firehose. Do not prove that Gemini discovered a new war.

## 3. Improved model. Keep Snowflake and Google. Isolate their failure modes.

Proposed pipeline. Live news APIs to Snowflake to a Google LLM. That story is fine for judges if the demo still works when one hop dies.

### Snowflake. Keep it as the warehouse.

Do not drop it to save money. The team already has access.

Use it this weekend if a table is writable on Friday night. Store normalized events. One row per event. Fields for source, time, lat, lon, type, confidence, and raw payload.

Challenge Snowflake only on speed and reliability.

- First-time auth, roles, network policies, and Python or Node drivers can burn half a Saturday.
- A cold warehouse can stall the first query during a live pitch.
- A campus firewall can block 443 to Snowflake.
- Debugging SQL on a shared account is slower than debugging a local file when the globe is blank.

Demo path. Snowflake is the system of record when the connector is green. The API that feeds the globe must also read a local snapshot. Write that snapshot from Snowflake on a timer. If Snowflake is dark, serve the last good snapshot. Judges see a live map either way.

Later enterprise path. Same schema. Streams or tasks. Role-based shares to a government or insurer tenant. Geospatial joins stay in Snowflake. Brief paid note. When the free grant ends, turn on a paid warehouse. Do not rewrite the model.

### Google Maps. Keep it as the globe.

The product brief wants a Google Maps-like globe. Free Maps access matches that brief. Use Maps JavaScript API. Keep Google attribution visible. Do not scrape tiles. Do not cache map content beyond what the service terms allow. Do not train models on Maps content. ([Maps Platform terms](https://cloud.google.com/maps-platform/terms), [JS API policies](https://developers.google.com/maps/documentation/javascript/policies).) Billing must still be enabled on the project even when someone else pays. Quotas can still kill a crowded judging room. ([Maps JS usage](https://developers.google.com/maps/documentation/javascript/usage-and-billing).)

Challenge Maps only on quality and licensing.

- A 3D photorealistic globe is a weekend trap. Ship a 2D map with a clean heatmap and markers first.
- Geocoding every news headline through Places or Geocoding will hit quota and will invent points. Prefer native coordinates from USGS and FIRMS.
- Do not imply the product is an official Google Crisis Map. That product is gone.

### Gemini. Keep it as the reasoner. Never as the source of truth.

Use Gemini to cluster headlines, extract entities, and draft relation hypotheses with citations. Show the model name and a confidence label.

Challenge Gemini on product quality.

- Latency can freeze a click. Precompute three demo stories.
- Hallucinated coordinates and fake causal links will lose judges and would lose a real buyer.
- Research finds shallow causal performance, order fallacies, and weak scores on real-world causal extraction. Best reported average F1 on ReCAST was 0.477. ([EMNLP 2024](https://aclanthology.org/2024.emnlp-main.590.pdf), [NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/af2bb2b2280d36f8842e440b4e275152-Paper-Conference.pdf), [ReCAST](https://arxiv.org/html/2505.18931v1).)

### News APIs. This is the weak hop, not Snowflake.

Do not make a commercial news API the core of the weekend build. Developer NewsAPI is for development only. Production Business is $449 per month. Terms forbid republishing copyrighted material and forbid building a competing news database. ([NewsAPI pricing](https://newsapi.org/pricing), [NewsAPI terms](https://newsapi.org/terms).) ReliefWeb, USGS, and FIRMS are the safer weekend sources.

Improved weekend pipeline:

1. Poll USGS and FIRMS on a short timer.
2. Optionally pull ReliefWeb reports and a small GDELT Project export or GDELT Cloud trial.
3. Write normalized rows to Snowflake.
4. Mirror to a local snapshot for the globe.
5. Run Gemini offline on a curated bundle to emit relation cards.
6. Serve a Next-class or Vite-class web app on Google Maps.

## 4. Unique wedge. Not another news heatmap.

The wedge is a **cross-domain link with a source trail and an explicit unknown**.

Example a judge can feel. A FIRMS cluster appears in a region. A ReliefWeb report or a GDELT story mentions displacement. Gemini proposes “possible linkage.” The card shows both sources, the time gap, and “not confirmed.”

That is not Dataminr-scale collection. That is not ACLED-quality coding. It is a product stance the crowded maps refuse to take.

### What LLMs can do here

- Deduplicate near-duplicate headlines.
- Pull people, orgs, places, and dates from text.
- Propose clusters and write a short brief.
- Rank which open sources a human should open next.

### What LLMs cannot do here

- Prove that event A caused event B.
- Replace ACLED or USGS as ground truth.
- Geolocate a vague political story with survey-grade points.
- Stay stable on fresh facts that were not in training. ([NeurIPS 2024 CausalProbe](https://proceedings.neurips.cc/paper_files/paper/2024/file/af2bb2b2280d36f8842e440b4e275152-Paper-Conference.pdf).)

Pitch language. “Hypothesis graph.” Never “AI detected the cause of the war.”

## 5. Data moats versus UI moats. Licensing risk.

**UI is not a moat.** Liveuamap already owns the consumer conflict map. Google Maps plus a heatmap is a weekend skill, not a company.

**Data can be a moat only if it is licensed, exclusive, or expensive to redo.** Maxar imagery and ACLED coding are that shape. Scraped news is not.

Licensing risks that can kill a real company and can embarrass a demo:

- NewsAPI and similar aggregators do not grant the right to republish article text. They also block a competing news archive. ([NewsAPI terms](https://newsapi.org/terms).)
- ReliefWeb content is often owned by the contributing partner. ([ReliefWeb API](https://apidoc.reliefweb.int/).)
- GDELT Project raw files are unrestricted. GDELT Cloud outputs are not for public re-serve without an OEM deal. ([GDELT about](https://gdeltproject.org/about.html), [GDELT Cloud terms](https://gdeltcloud.com/terms).)
- Liveuamap allows use of its data and maps with attribution. Third-party social text follows the original network terms. ([Liveuamap about](https://liveuamap.com/site/about/).)
- ACLED for-profit redistribution needs a paid license. ([EULA](https://acleddata.com/eula).)
- Google Maps content cannot be scraped, rehosted, or used to train models. Attribution cannot be hidden. ([Maps Platform terms](https://cloud.google.com/maps-platform/terms).)
- USGS and FIRMS are the cleanest weekend layers if you cite them.

Hackathon rule. Show title, source name, time, coordinates, and a link. Do not paste full article bodies on the map.

## 6. Monetization ranked

Rank is about willingness to pay and fit to a sensor-plus-hypothesis product. Prices below are comparables. They are not this team’s prices.

1. **Government and NGO.** Highest proven checks. ACLED already sells public-sector licenses. Dataminr claims a large public-sector base. A student product will not win a classified program. A narrow open-source fusion watchboard could become a later RFP add-on. Guess on close rate.

2. **Insurance and reinsurance.** They already buy flood, quake, and fire footprints. USGS and FIRMS are native to that job. A news heatmap is not. Public list prices for this exact product are unknown.

3. **Commodity and macro desks.** They pay six figures for geopolitical modules. Recorded Future geo is $281,250 per 36 months for two seats on AWS. Predata list price is unknown. This team will not beat those feeds on speed. A weekend “oil shock” story is a pitch device, not a desk.

4. **Corporate OSINT and security.** Dataminr and Crisis24 own the category. AWS list prices sit in the tens of thousands per team or per seat. A student globe is a toy next to First Alert. Use this tier only as the long-term narrative.

5. **Freemium prosumer.** Liveuamap already charges about $7 to $10 class PRO and $150 API. Hard to differentiate. Useful as a top-of-funnel, not as the company.

6. **Mass consumer.** Ads funded Liveuamap. Consumer news maps do not get Dataminr contracts. Skip as a primary plan.

Do not lead the pitch with consumer freemium. Lead with “we fuse open sensors the way an analyst starts a folder.”

## 7. Hackathon-winning moves

### Demo script. About four minutes.

1. Dark globe. One sentence. “Open sensors and a checked hypothesis. Not a news blob.”
2. Toggle earthquakes. A live USGS point pulses.
3. Toggle fires. FIRMS hotspots appear.
4. Toggle humanitarian reports. A ReliefWeb pin lands near one cluster.
5. Click the pin. Relation card. Two sources. Time gap. Confidence. “Unknown” if weak.
6. Toggle the political layer off. The card stays. The map simplifies.
7. One buyer line. Insurer or NGO. “They already trust these feeds. We stitch the first question.”

### Wow moment

The card that survives a judge opening both source URLs. The map is table stakes. The honest link is the memory.

### Judge risks

- Blank map because a key expired or a warehouse slept.
- Gemini invents a battle or a lat-lon.
- Someone says “this is just Liveuamap.”
- News-article dump looks like copyright theft.
- Too many layers. Nothing reads at two meters.

### Cut list

- Real-time Twitter or X firehose.
- Training a custom model.
- Photorealistic 3D tiles.
- Wars, terror, and financial shocks as live classifiers.
- Multiplayer accounts, auth, and billing.
- Snowflake streams, dbt, and a full semantic layer.
- Claiming OEM rights on GDELT Cloud.

## 8. MVP for four students in a weekend

Assume the four already have Google and Snowflake credentials before kickoff.

**Student A. Globe.** Maps JS, layer toggles, heatmap, marker popups, mobile layout, attribution.

**Student B. Ingest.** USGS and FIRMS into Snowflake. Snapshot writer. Health page that shows last success time.

**Student C. Relations.** Curated bundle of 10 to 20 events. Gemini batch. Cards with sources and confidence. No live prompt on the critical click.

**Student D. Narrative and fallback.** Script, sample buyer slide, offline snapshot, and a recorded 60-second backup video.

Must-have Friday night. Keys work. One Snowflake table accepts a row. One map load shows a hardcoded USGS point.

Must-have Saturday night. Two live layers. One relation card. Snapshot fallback.

Sunday. Polish, empty and error states, judge-proof source links.

If a student is missing. Drop student D’s slide polish last. Never drop the fallback snapshot.

## 9. Open questions versus verified facts

### Only the team can decide

- Which student hackathon and which judging rubric.
- Whether the live demo network can reach Snowflake and Google.
- Whether GDELT Cloud trial or raw GDELT Project files are allowed by that event’s rules.
- Whether they will name a fake company or stay a weekend tool.
- Whether the first buyer story is NGO, insurer, or campus OSINT club.
- How aggressive they want Gemini language to be.
- Whether any teammate already has a working Maps 3D sample. If no, stay 2D.

### Verified in this brief

- GDELT Project datasets are fee-free for commercial use. ([gdeltproject.org/about.html](https://gdeltproject.org/about.html).)
- GDELT Cloud public prices and no-redistribute rule. ([gdeltcloud.com/pricing](https://gdeltcloud.com/pricing), [gdeltcloud.com/terms](https://gdeltcloud.com/terms).)
- ACLED needs a corporate or public-sector license for those entity types. ([acleddata.com/eula](https://acleddata.com/eula).)
- Canada DND bought a 12-month ACLED OSINT subscription. Dollar amount not confirmed from CanadaBuys here. ([CanadaBuys](https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2418650-001).)
- ReliefWeb API is free. Partner copyright still applies. ([apidoc.reliefweb.int](https://apidoc.reliefweb.int/).)
- USGS scientific data are public domain by policy. ([USGS FAQ](https://www.usgs.gov/faqs/what-usgs-policy-release-scientific-data-are-any-usgs-products-restricted).)
- FIRMS is free with a MAP_KEY and a citation request. ([FIRMS FAQ](https://www.earthdata.nasa.gov/data/tools/firms/faq).)
- Liveuamap API $150 and $1000 tiers. ([liveuamap.com/promo/api](https://liveuamap.com/promo/api).)
- NewsAPI Business $449 per month and republication limits. ([newsapi.org/pricing](https://newsapi.org/pricing), [newsapi.org/terms](https://newsapi.org/terms).)
- Dataminr AWS list prices and Forrester composite fees. Links in section 1.
- Crisis24 Ukraine report $2,490 per week and Mass Notification $50,000 per year on AWS. Links in section 1.
- Recorded Future Geopolitical Intel $281,250 per 36 months on AWS. ([listing](https://aws.amazon.com/marketplace/pp/prodview-e2ttyopt6btwa).)
- Google Crisis Map standalone is dead. ([9to5Google](https://9to5google.com/2021/02/17/google-crisis-map/).)
- Google Maps terms ban scraping, extra caching, and training on Maps content. ([cloud.google.com/maps-platform/terms](https://cloud.google.com/maps-platform/terms).)
- LLM causal papers listed in section 4.

### Still unknown

- Predata price.
- Maxar MGP dollar price.
- Crisis24 Horizon seat price.
- ACLED enterprise list price.
- Official CanadaBuys dollar figure for W8484-26EK05.
- Whether the team’s “free Google” grant includes Maps JS, Geocoding, and Gemini or only some of those APIs.
- Whether the team’s “free Snowflake” grant allows outbound shares to judges’ browsers or only warehouse SQL.

Guess. A four-person weekend that ships USGS plus FIRMS plus three Gemini cards plus a Maps globe will beat a weekend that tries to ingest all world news.
