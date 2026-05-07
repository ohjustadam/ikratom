/**
 * Top 10 most-populous cities per US state, plus the state capital.
 *
 * Used by scripts/sync-major-cities.mjs to sweep local-officials data
 * beyond just capitals. Capital is always first; remaining cities are
 * ordered by approximate population (good enough for prioritization).
 *
 * If the capital is also one of the largest cities (Indianapolis,
 * Phoenix, etc.), it appears once.
 *
 * Source: 2020 Census tabulations + 2024 Census estimates. Reasonable
 * accuracy for prioritization; doesn't need to be perfect.
 */

export const STATE_CITIES = {
  AL: ["Montgomery", "Birmingham", "Huntsville", "Mobile", "Tuscaloosa", "Hoover", "Dothan", "Auburn", "Decatur", "Madison"],
  AK: ["Juneau", "Anchorage", "Fairbanks", "Wasilla", "Sitka", "Ketchikan", "Kenai", "Kodiak", "Bethel", "Palmer"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Gilbert", "Scottsdale", "Glendale", "Tempe", "Peoria", "Surprise"],
  AR: ["Little Rock", "Fort Smith", "Fayetteville", "Springdale", "Jonesboro", "North Little Rock", "Conway", "Rogers", "Bentonville", "Pine Bluff"],
  CA: ["Sacramento", "Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Long Beach", "Oakland", "Bakersfield", "Anaheim"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Thornton", "Arvada", "Westminster", "Pueblo", "Boulder"],
  CT: ["Hartford", "Bridgeport", "New Haven", "Stamford", "Waterbury", "Norwalk", "Danbury", "New Britain", "West Hartford", "Greenwich"],
  DE: ["Dover", "Wilmington", "Newark", "Middletown", "Smyrna", "Milford", "Seaford", "Georgetown", "Elsmere", "New Castle"],
  DC: ["Washington"],
  FL: ["Tallahassee", "Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Hialeah", "Cape Coral", "Port St. Lucie", "Fort Lauderdale"],
  GA: ["Atlanta", "Augusta", "Columbus", "Macon", "Savannah", "Athens", "Sandy Springs", "Roswell", "Johns Creek", "Albany"],
  HI: ["Honolulu", "Hilo", "Kailua", "Kapolei", "Kaneohe", "Mililani", "Pearl City", "Waipahu", "Wailuku", "Kahului"],
  ID: ["Boise", "Meridian", "Nampa", "Caldwell", "Idaho Falls", "Pocatello", "Coeur d'Alene", "Twin Falls", "Lewiston", "Post Falls"],
  IL: ["Springfield", "Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Elgin", "Peoria", "Champaign", "Waukegan"],
  IN: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Fishers", "Bloomington", "Hammond", "Gary", "Lafayette"],
  IA: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City", "Waterloo", "Council Bluffs", "Ames", "West Des Moines", "Dubuque"],
  KS: ["Topeka", "Wichita", "Overland Park", "Kansas City", "Olathe", "Lawrence", "Shawnee", "Manhattan", "Lenexa", "Salina"],
  KY: ["Frankfort", "Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington", "Hopkinsville", "Richmond", "Florence", "Georgetown"],
  LA: ["Baton Rouge", "New Orleans", "Shreveport", "Lafayette", "Lake Charles", "Kenner", "Bossier City", "Monroe", "Alexandria", "Houma"],
  ME: ["Augusta", "Portland", "Lewiston", "Bangor", "South Portland", "Auburn", "Biddeford", "Sanford", "Saco", "Westbrook"],
  MD: ["Annapolis", "Baltimore", "Frederick", "Rockville", "Gaithersburg", "Bowie", "Hagerstown", "Salisbury", "Greenbelt", "Cumberland"],
  MA: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "Quincy", "Lynn", "New Bedford", "Newton"],
  MI: ["Lansing", "Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Dearborn", "Livonia", "Troy", "Westland"],
  MN: ["Saint Paul", "Minneapolis", "Rochester", "Bloomington", "Duluth", "Brooklyn Park", "Plymouth", "Maple Grove", "Woodbury", "St. Cloud"],
  MS: ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi", "Tupelo", "Olive Branch", "Meridian", "Greenville", "Horn Lake"],
  MO: ["Jefferson City", "Kansas City", "St. Louis", "Springfield", "Columbia", "Independence", "Lee's Summit", "O'Fallon", "St. Joseph", "St. Charles"],
  MT: ["Helena", "Billings", "Missoula", "Great Falls", "Bozeman", "Butte", "Kalispell", "Belgrade", "Anaconda", "Livingston"],
  NE: ["Lincoln", "Omaha", "Bellevue", "Grand Island", "Kearney", "Fremont", "Hastings", "North Platte", "Norfolk", "Columbus"],
  NV: ["Carson City", "Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks", "Spring Valley", "Sunrise Manor", "Paradise", "Enterprise"],
  NH: ["Concord", "Manchester", "Nashua", "Derry", "Dover", "Rochester", "Salem", "Merrimack", "Hudson", "Londonderry"],
  NJ: ["Trenton", "Newark", "Jersey City", "Paterson", "Elizabeth", "Edison", "Woodbridge", "Lakewood", "Toms River", "Hamilton"],
  NM: ["Santa Fe", "Albuquerque", "Las Cruces", "Rio Rancho", "Roswell", "Farmington", "Clovis", "Hobbs", "Alamogordo", "Carlsbad"],
  NY: ["Albany", "New York", "Buffalo", "Yonkers", "Rochester", "Syracuse", "New Rochelle", "Mount Vernon", "Schenectady", "Utica"],
  NC: ["Raleigh", "Charlotte", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "High Point", "Greenville"],
  ND: ["Bismarck", "Fargo", "Grand Forks", "Minot", "West Fargo", "Williston", "Mandan", "Dickinson", "Jamestown", "Wahpeton"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Parma", "Canton", "Youngstown", "Lorain"],
  OK: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond", "Lawton", "Moore", "Midwest City", "Enid", "Stillwater"],
  OR: ["Salem", "Portland", "Eugene", "Gresham", "Hillsboro", "Beaverton", "Bend", "Medford", "Springfield", "Corvallis"],
  PA: ["Harrisburg", "Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Bethlehem", "Lancaster", "Levittown"],
  RI: ["Providence", "Cranston", "Warwick", "Pawtucket", "East Providence", "Woonsocket", "Coventry", "Cumberland", "North Providence", "South Kingstown"],
  SC: ["Columbia", "Charleston", "North Charleston", "Mount Pleasant", "Rock Hill", "Greenville", "Summerville", "Sumter", "Goose Creek", "Hilton Head Island"],
  SD: ["Pierre", "Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown", "Mitchell", "Yankton", "Huron", "Vermillion"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin", "Jackson", "Johnson City", "Bartlett"],
  TX: ["Austin", "Houston", "San Antonio", "Dallas", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Plano", "Lubbock"],
  UT: ["Salt Lake City", "West Valley City", "West Jordan", "Provo", "Orem", "Sandy", "Ogden", "St. George", "Layton", "South Jordan"],
  VT: ["Montpelier", "Burlington", "South Burlington", "Rutland", "Essex Junction", "Barre", "Winooski", "St. Albans", "Newport", "Vergennes"],
  VA: ["Richmond", "Virginia Beach", "Norfolk", "Chesapeake", "Arlington", "Newport News", "Alexandria", "Hampton", "Roanoke", "Portsmouth"],
  WA: ["Olympia", "Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Kent", "Everett", "Renton", "Spokane Valley"],
  WV: ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling", "Weirton", "Fairmont", "Beckley", "Martinsburg", "Clarksburg"],
  WI: ["Madison", "Milwaukee", "Green Bay", "Kenosha", "Racine", "Appleton", "Waukesha", "Eau Claire", "Oshkosh", "Janesville"],
  WY: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs", "Sheridan", "Green River", "Evanston", "Riverton", "Jackson"],
};

/**
 * Total: ~510 (50 states × ~10) + DC. Sweep ETA varies by provider:
 *  - Gemini grounded: ~10s/city × 510 = 85min, gates on 1500/day quota
 *  - Ollama llama3.3:70b: ~30s/city × 510 = 4.25hr, no quota gate
 */
