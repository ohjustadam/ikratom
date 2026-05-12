/**
 * Curated list of high-leverage Granicus tenants for the proactive
 * tenant scan. Each entry is a city/county/agency running on its own
 * granicus.com subdomain.
 *
 * Coverage priorities:
 *   - Largest US cities (top 30 by population)
 *   - California cities (high kratom-policy activity)
 *   - Major counties in priority states (NY, FL, TX, OH, MI, WA)
 *
 * To add a tenant: visit {subdomain}.granicus.com/ViewPublisher.php?view_id=1
 * (try view_id=1, 2, 3 until you find the active one). The locality
 * string should match what shows in /calendar UI.
 */
export const GRANICUS_TENANTS = [
  // Top US cities
  { subdomain: "lacity", state: "CA", locality: "Los Angeles, CA", body: "City Council", viewId: 14 },
  { subdomain: "lacounty", state: "CA", locality: "Los Angeles County, CA", body: "Board of Supervisors", viewId: 1 },
  { subdomain: "sanfrancisco", state: "CA", locality: "San Francisco, CA", body: "Board of Supervisors", viewId: 10 },
  { subdomain: "sanjoseca", state: "CA", locality: "San Jose, CA", body: "City Council", viewId: 2 },
  { subdomain: "sandiego", state: "CA", locality: "San Diego, CA", body: "City Council", viewId: 5 },
  { subdomain: "longbeach", state: "CA", locality: "Long Beach, CA", body: "City Council", viewId: 8 },
  { subdomain: "sacramento", state: "CA", locality: "Sacramento, CA", body: "City Council", viewId: 14 },
  { subdomain: "oakland", state: "CA", locality: "Oakland, CA", body: "City Council", viewId: 2 },
  { subdomain: "fresno", state: "CA", locality: "Fresno, CA", body: "City Council", viewId: 1 },
  { subdomain: "anaheim", state: "CA", locality: "Anaheim, CA", body: "City Council", viewId: 4 },

  // Pacific Northwest
  { subdomain: "seattle", state: "WA", locality: "Seattle, WA", body: "City Council", viewId: 4 },
  { subdomain: "spokanecity", state: "WA", locality: "Spokane, WA", body: "City Council", viewId: 1 },
  { subdomain: "portland", state: "OR", locality: "Portland, OR", body: "City Council", viewId: 2 },

  // Mountain + Southwest
  { subdomain: "phoenix", state: "AZ", locality: "Phoenix, AZ", body: "City Council", viewId: 4 },
  { subdomain: "tucsonaz", state: "AZ", locality: "Tucson, AZ", body: "Mayor and Council", viewId: 2 },
  { subdomain: "lasvegas", state: "NV", locality: "Las Vegas, NV", body: "City Council", viewId: 4 },
  { subdomain: "denver", state: "CO", locality: "Denver, CO", body: "City Council", viewId: 23 },
  { subdomain: "saltlakecity", state: "UT", locality: "Salt Lake City, UT", body: "City Council", viewId: 2 },

  // Midwest
  { subdomain: "chicago", state: "IL", locality: "Chicago, IL", body: "City Council", viewId: 2 },
  { subdomain: "minneapolismn", state: "MN", locality: "Minneapolis, MN", body: "City Council", viewId: 1 },
  { subdomain: "stpaul", state: "MN", locality: "Saint Paul, MN", body: "City Council", viewId: 1 },
  { subdomain: "milwaukee", state: "WI", locality: "Milwaukee, WI", body: "Common Council", viewId: 1 },
  { subdomain: "detroitmi", state: "MI", locality: "Detroit, MI", body: "City Council", viewId: 1 },
  { subdomain: "columbus", state: "OH", locality: "Columbus, OH", body: "City Council", viewId: 2 },
  { subdomain: "cleveland", state: "OH", locality: "Cleveland, OH", body: "City Council", viewId: 4 },

  // South + Southeast
  { subdomain: "atlanta", state: "GA", locality: "Atlanta, GA", body: "City Council", viewId: 1 },
  { subdomain: "charlottenc", state: "NC", locality: "Charlotte, NC", body: "City Council", viewId: 1 },
  { subdomain: "raleighnc", state: "NC", locality: "Raleigh, NC", body: "City Council", viewId: 4 },
  { subdomain: "jacksonville", state: "FL", locality: "Jacksonville, FL", body: "City Council", viewId: 2 },
  { subdomain: "tampagov", state: "FL", locality: "Tampa, FL", body: "City Council", viewId: 4 },
  { subdomain: "miamifl", state: "FL", locality: "Miami, FL", body: "City Commission", viewId: 1 },
  { subdomain: "miamidade", state: "FL", locality: "Miami-Dade County, FL", body: "Board of County Commissioners", viewId: 1 },
  { subdomain: "orlandofl", state: "FL", locality: "Orlando, FL", body: "City Council", viewId: 1 },

  // Texas
  { subdomain: "austintexas", state: "TX", locality: "Austin, TX", body: "City Council", viewId: 4 },
  { subdomain: "dallascityhall", state: "TX", locality: "Dallas, TX", body: "City Council", viewId: 2 },
  { subdomain: "houstontx", state: "TX", locality: "Houston, TX", body: "City Council", viewId: 1 },
  { subdomain: "sanantonio", state: "TX", locality: "San Antonio, TX", body: "City Council", viewId: 5 },
  { subdomain: "fortworthgov", state: "TX", locality: "Fort Worth, TX", body: "City Council", viewId: 4 },

  // Northeast
  { subdomain: "boston", state: "MA", locality: "Boston, MA", body: "City Council", viewId: 1 },
  { subdomain: "phila", state: "PA", locality: "Philadelphia, PA", body: "City Council", viewId: 2 },
  { subdomain: "pittsburghpa", state: "PA", locality: "Pittsburgh, PA", body: "City Council", viewId: 2 },
  { subdomain: "baltimorecity", state: "MD", locality: "Baltimore, MD", body: "City Council", viewId: 2 },
  { subdomain: "dc", state: "DC", locality: "Washington, DC", body: "Council of the District of Columbia", viewId: 1 },
];
