import { FirecrawlAppV1, Firecrawl } from "../../index";

const testTimeoutPropagation = () => {
  const testApiKey = "test-key";
  const testUrl = "https://example.com";

  console.log("Testing timeout propagation in both v1 and v2 clients");
  
  const testV1Timeout = async () => {
    const app = new FirecrawlAppV1({ apiKey: testApiKey });
    const startTime = Date.now();
    
    try {
      await app.scrapeUrl(testUrl, { timeout: 1000 });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`V1 timeout test elapsed: ${elapsed}ms`);
      return elapsed < 10000;
    }
    return false;
  };
  
  const testV2Timeout = async () => {
    const app = new Firecrawl({ apiKey: testApiKey });
    const startTime = Date.now();
    
    try {
      await app.scrape(testUrl, { timeout: 1000 });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`V2 timeout test elapsed: ${elapsed}ms`);
      return elapsed < 10000;
    }
    return false;
  };
  
  const testWaitForTimeout = async () => {
    const app = new FirecrawlAppV1({ apiKey: testApiKey });
    const startTime = Date.now();
    
    try {
      await app.scrapeUrl(testUrl, { 
        timeout: 2000,
        waitFor: 1000
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`WaitFor timeout test elapsed: ${elapsed}ms`);
      return elapsed < 15000;
    }
    return false;
  };
  
  const testActionTimeout = async () => {
    const app = new FirecrawlAppV1({ apiKey: testApiKey });
    const startTime = Date.now();
    
    try {
      await app.scrapeUrl(testUrl, { 
        timeout: 2000,
        actions: [
          { type: "wait", milliseconds: 1000 },
          { type: "wait", selector: ".some-element" }
        ]
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`Action timeout test elapsed: ${elapsed}ms`);
      return elapsed < 15000;
    }
    return false;
  };
  
  const testZeroTimeout = async () => {
    const app = new FirecrawlAppV1({ apiKey: testApiKey });
    const startTime = Date.now();
    
    try {
      await app.scrapeUrl(testUrl, { timeout: 0 });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.log(`Zero timeout test elapsed: ${elapsed}ms`);
      return elapsed < 10000;
    }
    return false;
  };

  return Promise.all([
    testV1Timeout(),
    testV2Timeout(), 
    testWaitForTimeout(),
    testActionTimeout(),
    testZeroTimeout()
  ]).then(results => {
    console.log("All timeout tests completed");
    return results.every(result => result);
  });
};

export { testTimeoutPropagation };
