// Fake news sources for tests: Benzinga (Alpaca), SEC (tickers, current 8-K Atom, submissions, Form 4 XML), GlobeNewswire RSS,
// PR Newswire (blocked), Fed RSS, FRED release dates per release id (v0.11.1: returns the matching M.fredDates rows, empty by default).
import { M } from './mock.mjs';
const now = Date.now(), iso = (h) => new Date(now - h * 36e5).toISOString(), rfc = (h) => new Date(now - h * 36e5).toUTCString(), day = (d) => new Date(now - d * 864e5).toISOString().slice(0, 10);
export const NEWS = [
  { id: 1, headline: 'Apple beats estimates, raises full-year outlook', summary: 'iPhone sales strong', source: 'benzinga', author: 'A', created_at: iso(2), url: 'https://x/1', symbols: ['AAPL'] },
  { id: 2, headline: 'Morgan Stanley downgrades XYZ to Underweight', summary: '', source: 'benzinga', author: 'B', created_at: iso(5), url: 'https://x/2', symbols: ['XYZ'] },
  { id: 3, headline: 'Fed holds rates steady; Powell signals patience', summary: '', source: 'benzinga', author: 'C', created_at: iso(3), url: 'https://x/3', symbols: [] },
  { id: 4, headline: 'Apple supplier update', summary: '', source: 'benzinga', author: 'D', created_at: iso(30), url: 'https://x/4', symbols: ['AAPL'] },
  { id: 5, headline: 'Bitcoin climbs past resistance', summary: '', source: 'benzinga', author: 'E', created_at: iso(1), url: 'https://x/5', symbols: ['BTCUSD'] },
];
const ATOM = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom"><title>Latest Filings</title>
<entry><title>8-K - Apple Inc. (0000320193) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000070-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; ${day(0)} &lt;b&gt;AccNo:&lt;/b&gt; 0000320193-26-000070 &lt;b&gt;Size:&lt;/b&gt; 300 KB&lt;br&gt;Item 2.02: Results of Operations and Financial Condition&lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary>
<updated>${iso(1)}</updated><category scheme="https://www.sec.gov/" label="form type" term="8-K"/><id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000070</id></entry>
<entry><title>8-K - ABCD Therapeutics Inc. (0000000222) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/222/x-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; ${day(0)}&lt;br&gt;Item 3.02: Unregistered Sales of Equity Securities&lt;br&gt;Item 8.01: Other Events</summary><updated>${iso(4)}</updated><id>urn:x:2</id></entry>
<entry><title>8-K - Some Private Fund LP (0000999999) (Filer)</title><link href="https://www.sec.gov/y"/><summary type="html">Item 8.01: Other Events</summary><updated>${iso(2)}</updated><id>urn:x:3</id></entry></feed>`;
const GNW = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>GlobeNewswire</title>
<item><guid isPermaLink="false">g1</guid><link>https://www.globenewswire.com/news-release/1</link><title><![CDATA[ABCD Therapeutics Announces Pricing of $50 Million Public Offering]]></title>
<description><![CDATA[<p>ABCD Therapeutics, Inc. (NASDAQ: ABCD) today announced the pricing of an underwritten public offering &amp; more.</p>]]></description><pubDate>${rfc(3)}</pubDate><category>Company Announcement</category></item>
<item><guid>g2</guid><link>https://www.globenewswire.com/news-release/2</link><title>INVESTOR ALERT: Pomerantz Law Firm Investigates Claims On Behalf of Investors of XYZ Corp. - XYZ</title>
<description>Pomerantz LLP is investigating claims on behalf of investors of XYZ Corp. (NYSE: XYZ).</description><pubDate>${rfc(2)}</pubDate></item>
<item><guid>g3</guid><link>https://www.globenewswire.com/news-release/3</link><title>MSFT Partner Co. Reports Record Revenue for Third Quarter</title><description>Partner Co (Nasdaq:MSFT) reports third quarter results with record revenue.</description><pubDate>${rfc(6)}</pubDate></item>
</channel></rss>`;
const FED = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary.htm</link><description>Statement</description><pubDate>${rfc(4)}</pubDate></item></channel></rss>`;
export const SUBS_AAPL = { filings: { recent: { form: ['8-K', '10-Q', '8-K', '8-K', '424B5'], filingDate: [day(89), day(90), day(180), day(362), day(400)], items: ['2.02,9.01', '', '2.02,9.01', '2.02,9.01', ''] } } };
// INSD (v0.11.0): three Form 4s in the last 30 days (a director's $60k open-market buy, an officer's sale, a 10% owner's buy that
// doesn't count) and one older than 30 days that must be ignored.
const SUBS_INSD = { filings: { recent: { form: ['4', '4', '4', '10-Q', '4'], filingDate: [day(3), day(10), day(12), day(20), day(45)], items: ['', '', '', '', ''],
  accessionNumber: ['0000333-26-000004', '0000333-26-000003', '0000333-26-000002', '0000333-26-000001', '0000333-26-000000'], primaryDocument: ['xslF345X05/f4a.xml', 'xslF345X05/f4b.xml', 'xslF345X05/f4c.xml', 'q.htm', 'xslF345X05/f4old.xml'] } } };
const f4 = (rel, rows) => `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerRelationship>${rel}</reportingOwnerRelationship></reportingOwner><nonDerivativeTable>${rows.map(([c, sh, px]) => `<nonDerivativeTransaction><transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${c}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${sh}</value></transactionShares><transactionPricePerShare><value>${px}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${c === 'S' ? 'D' : 'A'}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>`).join('')}</nonDerivativeTable></ownershipDocument>`;
export const F4XML = { 'f4a.xml': f4('<isDirector>1</isDirector>', [['P', 1000, 40], ['P', 500, 40]]), 'f4b.xml': f4('<isOfficer>true</isOfficer><officerTitle>CFO</officerTitle>', [['S', 2000, 41], ['M', 2000, 10]]),
  'f4c.xml': f4('<isTenPercentOwner>1</isTenPercentOwner>', [['P', 100000, 40]]), 'f4old.xml': f4('<isDirector>1</isDirector>', [['P', 9999, 40]]) };
const SUBS_ABCD = { filings: { recent: { form: ['8-K', '424B5'], filingDate: [day(0), day(1)], items: ['3.02,8.01', ''] } } };
const base = global.fetch;
global.fetch = async (url, opt = {}) => {
  const u = new URL(url), h = u.hostname;
  const T = (body, status = 200) => new Response(body, { status });
  if (h === 'data.alpaca.markets' && u.pathname === '/v1beta1/news') { M.newsCalls = (M.newsCalls || 0) + 1; const sy = (u.searchParams.get('symbols') || '').split(',').filter(Boolean); return T(JSON.stringify({ news: NEWS.filter(n => !sy.length || n.symbols.some(s => sy.includes(s))), next_page_token: null })); }
  if (h === 'www.sec.gov' && u.pathname === '/files/company_tickers.json') { M.secUA = opt.headers?.['user-agent']; return T(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 222, ticker: 'ABCD', title: 'ABCD Therapeutics' }, 2: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft' }, 3: { cik_str: 111, ticker: 'XYZ', title: 'XYZ Corp' }, 4: { cik_str: 333, ticker: 'INSD', title: 'Insider Co' } })); }
  if (h === 'www.sec.gov' && u.pathname === '/cgi-bin/browse-edgar') return T(ATOM);
  if (h === 'data.sec.gov') return T(JSON.stringify((u.pathname.includes('320193') || u.pathname.includes('789019')) ? SUBS_AAPL : u.pathname.includes('0000000222') ? SUBS_ABCD : u.pathname.includes('0000000333') ? SUBS_INSD : { filings: { recent: { form: [], filingDate: [], items: [] } } }));
  if (h === 'www.sec.gov' && u.pathname.startsWith('/Archives/edgar/data/')) { (M.secArchive ||= []).push(u.pathname); (M.secTimes ||= []).push(Date.now()); const doc = u.pathname.split('/').pop(); return F4XML[doc] ? T(F4XML[doc]) : T('not found', 404); }
  if (h === 'api.stlouisfed.org' && u.pathname === '/fred/release/dates') { M.fredCalls = (M.fredCalls || 0) + 1; M.fredQuery = Object.fromEntries(u.searchParams); (M.fredIds ||= []).push(+u.searchParams.get('release_id'));
    const id = +u.searchParams.get('release_id'); return M.fredStatus && (!M.fredBadIds || M.fredBadIds.includes(id)) ? T('err', M.fredStatus) : T(JSON.stringify({ release_dates: (M.fredDates || []).filter(x => x.release_id === id).map(({ release_id, date }) => ({ release_id, date })) })); }
  if (h === 'www.globenewswire.com') return T(GNW);
  if (h === 'www.prnewswire.com') return T('blocked', 403);
  if (h === 'www.federalreserve.gov') return T(FED);
  return base(url, opt);
};
