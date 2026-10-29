// Responses copied from the examples in Sedo's API docs
// (https://api.sedo.com/apidocs/v1/Basic/, 2026-10-27), quirks included:
// DomainStatus's string currency, the parking example's mismatched closing
// tag, payments under `payments`. UNVERIFIED against the live API; replace
// with recorded shapes once there are credentials.

export const checkMember = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOCHECKMEMBER ver="1.0">
    <member type="xsd:int">1</member>
</SEDOCHECKMEMBER>`;

export const domainList = `<?xml version="1.0" encoding="UTF-8"?>
<SEDODOMAINLIST ver="1.0">
    <item>
        <domain type="xsd:string">example.com</domain>
        <category>
            <cat1 type="xsd:int">1</cat1>
            <cat2 type="xsd:int">2</cat2>
            <cat3 type="xsd:int">3</cat3>
        </category>
        <forsale type="xsd:int">1</forsale>
        <price type="xsd:double">99.99</price>
        <minprice type="xsd:double">0.00</minprice>
        <fixedprice type="xsd:int">1</fixedprice>
        <currency type="xsd:int">1</currency>
        <domainlanguage type="xsd:string">en</domainlanguage>
    </item>
    <item>
        <domain type="xsd:string">example.net</domain>
        <category>
            <cat1 type="xsd:int">1</cat1>
            <cat2 type="xsd:int">2</cat2>
            <cat3 type="xsd:int">3</cat3>
        </category>
        <forsale type="xsd:int">1</forsale>
        <price type="xsd:double">99.99</price>
        <minprice type="xsd:double">0.00</minprice>
        <fixedprice type="xsd:int">1</fixedprice>
        <currency type="xsd:int">1</currency>
        <domainlanguage type="xsd:string">en</domainlanguage>
    </item>
</SEDODOMAINLIST>`;

export const domainListExtended = `<?xml version="1.0" encoding="UTF-8"?>
<SEDODOMAINLIST ver="1.0">
    <item>
        <domain type="xsd:string">example.com</domain>
        <category>
            <cat1 type="xsd:int">1</cat1>
            <cat2 type="xsd:int">2</cat2>
            <cat3 type="xsd:int">3</cat3>
        </category>
        <forsale type="xsd:int">1</forsale>
        <price type="xsd:double">99.99</price>
        <minprice type="xsd:double">0.00</minprice>
        <fixedprice type="xsd:int">1</fixedprice>
        <currency type="xsd:int">1</currency>
        <domainlanguage type="xsd:string">en</domainlanguage>
        <keywords type="xsd:string">
            <keyword>
                <keyword>Keyword</keyword>
                <market>xyz</market>
                <advertiser>0</advertiser>
                <views>0</views>
                <clicks>0</clicks>
                <earnings>0</earnings>
                <rpm>0</rpm>
                <inserted>2012-12-04 15:16:27</inserted>
            </keyword>
        </keywords>
        <inserted type="xsd:string">989704800</inserted>
        <earningscomplete type="xsd:double">0.94</earningscomplete>
    </item>
</SEDODOMAINLIST>`;

export const domainStatus = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOLIST xmlns="api.sedo.com/api/v1/?wsdl">
    <item type="tns:DomainStatusResponse[]">
        <domain type="xsd:string">example.com</domain>
        <type type="xsd:string">false</type>
        <forsale type="xsd:boolean">true</forsale>
        <price type="xsd:decimal">500</price>
        <currency type="xsd:string">EUR</currency>
        <visitors type="xsd:int">0</visitors>
        <domainstatus type="xsd:decimal">1</domainstatus>
    </item>
    <item type="tns:DomainStatusResponse[]">
        <domain type="xsd:string">example.net</domain>
        <type type="xsd:string">false</type>
        <forsale type="xsd:boolean">true</forsale>
        <price type="xsd:decimal">500</price>
        <currency type="xsd:string">EUR</currency>
        <visitors type="xsd:int">0</visitors>
        <domainstatus type="xsd:decimal">1</domainstatus>
    </item>
</SEDOLIST>`;

/** The docs' example, mismatched `</earnings>` and all. */
export const parkingStats = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOSTATS ver="1.0">
    <item>
        <domain type="xsd:string">example.com</domain>
        <date type="xsd:string">2017-01-01</date>
        <visitors type="xsd:int">0</visitors>
        <clicks type="xsd:int">0</clicks>
        <earnings type="xsd:double">0</earnings>
        <payout_status type="xsd:string">Estimated</earnings>
    </item>
</SEDOSTATS>`;

export const parkingPayments = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOSTATS ver="1.0">
    <item>
        <date type="xsd:string">2017-01-01</date>
        <payments type="xsd:double">0</payments>
    </item>
</SEDOSTATS>`;

export const insertResult = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOLIST xmlns="https://api.sedo.com/api/v1/?wsdl">
 <item type="tns:DomainInsertResponse[]">
 <domain type="xsd:string">example.com</domain>
 <status type="xsd:string">ok</status>
 <message type="xsd:string"/>
 </item>
 <item type="tns:DomainInsertResponse[]">
 <domain type="xsd:string">example.net</domain>
 <status type="xsd:string">ok</status>
 <message type="xsd:string"/>
 </item>
</SEDOLIST>`;

export const fault = `<?xml version="1.0" encoding="UTF-8"?>
<SEDOFAULT ver="1.0">
 <faultcode type="xsd:string">Exxx</faultcode>
 <faultstring type="xsd:string">xxxxxx</faultstring>
</SEDOFAULT>`;

/** A fault document with a given code and string. */
export function faultOf(code: string, message: string): string {
  return fault.replace('Exxx', code).replace('xxxxxx', message);
}

export const categories = `<?xml version="1.0" encoding="UTF-8"?>
<SEDODOMAINCATEGORIES ver="1.0">
    <maincategory id="104" name="Consumer Goods">
        <subcategory1 id="10" name="General" />
        <subcategory1 id="243" name="Electronics">
            <subcategory2 id="244" name="General" />
            <subcategory2 id="248" name="CDs" />
        </subcategory1>
    </maincategory>
</SEDODOMAINCATEGORIES>`;

export const languages = `<?xml version="1.0" encoding="UTF-8"?>
<SEDODOMAINLANGUAGES ver="1.0">
    <language iso="af">Afrikaans</language>
    <language iso="en">English</language>
</SEDODOMAINLANGUAGES>`;

/** A list response with these listings, in DomainList's shape. */
export function listOf(
  rows: {
    domain: string;
    forsale?: 0 | 1;
    price?: string;
    minprice?: string;
    fixedprice?: 0 | 1;
    currency?: 0 | 1 | 2;
    language?: string;
    categories?: number[];
  }[],
): string {
  const item = (r: (typeof rows)[number]) => `
    <item>
        <domain type="xsd:string">${r.domain}</domain>
        <category>${(r.categories ?? [])
          .map((c, i) => `<cat${i + 1} type="xsd:int">${c}</cat${i + 1}>`)
          .join('')}</category>
        <forsale type="xsd:int">${r.forsale ?? 1}</forsale>
        <price type="xsd:double">${r.price ?? '0.00'}</price>
        <minprice type="xsd:double">${r.minprice ?? '0.00'}</minprice>
        <fixedprice type="xsd:int">${r.fixedprice ?? 0}</fixedprice>
        <currency type="xsd:int">${r.currency ?? 1}</currency>
        <domainlanguage type="xsd:string">${r.language ?? 'en'}</domainlanguage>
    </item>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<SEDODOMAINLIST ver="1.0">${rows.map(item).join('')}
</SEDODOMAINLIST>`;
}

/** A batch-write response: `ok`, or [code, message] per name. */
export function resultsOf(rows: [domain: string, status?: [string, string]][]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SEDOLIST xmlns="https://api.sedo.com/api/v1/?wsdl">${rows
    .map(
      ([domain, failed]) => `
 <item type="tns:DomainEditResponse[]">
 <domain type="xsd:string">${domain}</domain>
 <status type="xsd:string">${failed ? failed[0] : 'ok'}</status>
 <message type="xsd:string">${failed ? failed[1] : ''}</message>
 </item>`,
    )
    .join('')}
</SEDOLIST>`;
}
