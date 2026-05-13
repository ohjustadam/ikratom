/**
 * Curated list of high-leverage Legistar tenants for proactive scan.
 * Each entry is a city/county running on a Legistar subdomain or
 * vanity domain.
 *
 * Legistar's URL structure varies more than Granicus's:
 *   - Standard:   {city}.legistar.com/Calendar.aspx
 *   - Vanity:     legistar.council.nyc.gov (NYC), sfgov.legistar.com (SF)
 *
 * The `calendarUrl` field is the explicit URL to the calendar list
 * page — needed because tenants pick different paths.
 *
 * To add a tenant: open the tenant's Legistar calendar in a browser
 * (usually findable from "agenda" or "meeting" links on the city's
 * official site). Copy the URL.
 */
export const LEGISTAR_TENANTS = [
  // NYC — the highest-leverage US Legistar tenant
  {
    subdomain: "council.nyc.gov",
    state: "NY",
    locality: "New York, NY",
    body: "City Council",
    calendarUrl: "https://legistar.council.nyc.gov/Calendar.aspx",
  },
  // California
  {
    subdomain: "sfgov",
    state: "CA",
    locality: "San Francisco, CA",
    body: "Board of Supervisors",
    calendarUrl: "https://sfgov.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "lacountybos",
    state: "CA",
    locality: "Los Angeles County, CA",
    body: "Board of Supervisors",
    calendarUrl: "https://lacountybos.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "alameda",
    state: "CA",
    locality: "Alameda County, CA",
    body: "Board of Supervisors",
    calendarUrl: "https://alameda.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "sccgov-bos",
    state: "CA",
    locality: "Santa Clara County, CA",
    body: "Board of Supervisors",
    calendarUrl: "https://sccgov-bos.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "longbeach",
    state: "CA",
    locality: "Long Beach, CA",
    body: "City Council",
    calendarUrl: "https://longbeach.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "berkeley",
    state: "CA",
    locality: "Berkeley, CA",
    body: "City Council",
    calendarUrl: "https://berkeley.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "richmondca",
    state: "CA",
    locality: "Richmond, CA",
    body: "City Council",
    calendarUrl: "https://richmondca.legistar.com/Calendar.aspx",
  },

  // East Coast — major Legistar cities
  {
    subdomain: "phila",
    state: "PA",
    locality: "Philadelphia, PA",
    body: "City Council",
    calendarUrl: "https://phila.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "newark",
    state: "NJ",
    locality: "Newark, NJ",
    body: "Municipal Council",
    calendarUrl: "https://newark.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "alexandria",
    state: "VA",
    locality: "Alexandria, VA",
    body: "City Council",
    calendarUrl: "https://alexandria.legistar.com/Calendar.aspx",
  },

  // Midwest
  {
    subdomain: "chicago",
    state: "IL",
    locality: "Chicago, IL",
    body: "City Council",
    calendarUrl: "https://chicago.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "cookcountyil",
    state: "IL",
    locality: "Cook County, IL",
    body: "Board of Commissioners",
    calendarUrl: "https://cook-county.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "stlouis-mo",
    state: "MO",
    locality: "St. Louis, MO",
    body: "Board of Aldermen",
    calendarUrl: "https://stlouis-mo.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "kansascity",
    state: "MO",
    locality: "Kansas City, MO",
    body: "City Council",
    calendarUrl: "https://cityclerk.kcmo.org/LiveWeb/Calendar.aspx",
  },

  // South + Southwest
  {
    subdomain: "sanantonio",
    state: "TX",
    locality: "San Antonio, TX",
    body: "City Council",
    calendarUrl: "https://sanantonio.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "atlantacityga",
    state: "GA",
    locality: "Atlanta, GA",
    body: "City Council",
    calendarUrl: "https://atlantacityga.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "miamigov",
    state: "FL",
    locality: "Miami, FL",
    body: "City Commission",
    calendarUrl: "https://miamigov.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "broward",
    state: "FL",
    locality: "Broward County, FL",
    body: "Board of County Commissioners",
    calendarUrl: "https://broward.legistar.com/Calendar.aspx",
  },

  // Northwest
  {
    subdomain: "seattle",
    state: "WA",
    locality: "Seattle, WA",
    body: "City Council",
    calendarUrl: "https://seattle.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "kingcounty",
    state: "WA",
    locality: "King County, WA",
    body: "County Council",
    calendarUrl: "https://kingcounty.legistar.com/Calendar.aspx",
  },
  {
    subdomain: "metro",
    state: "OR",
    locality: "Portland Metro, OR",
    body: "Metro Council",
    calendarUrl: "https://oregonmetro.legistar.com/Calendar.aspx",
  },
];
