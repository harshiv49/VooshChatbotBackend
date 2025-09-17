// scraper.ts - Professional Grade Scraper
// load documents as they would in chrome using a headless browser (pupeteer)
// extract the essential  readable content from the pages mimicing firefox read only mode for news using mozilla readability library
import puppeteer from "puppeteer";
import fs from "fs/promises";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { Browser } from "puppeteer";

const URL_LIST_FILE = "../embeddings/urls.txt";
const OUTPUT_FILE = "../embeddings/news_corpus.json";

interface ArticleData {
  url: string;
  title: string | null | undefined;
  content: string;
}

async function scrapeArticle(
  browser: Browser,
  url: string
): Promise<ArticleData | null> {
  // launch every article as an HTML page
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const htmlContent = await page.content();
    const dom = new JSDOM(htmlContent, { url });

    // get the content of every article as JSON
    // use readability to extract only the readable important content from the document
    const reader = new Readability(dom.window.document as any);
    const article = reader.parse();

    if (!article || !article.textContent) {
      console.warn(`Readability could not extract content from: ${url}`);
      return null;
    }

    return {
      url,
      title: article.title,
      content: article.textContent.trim(),
    };
  } catch (error: any) {
    console.error(`Error scraping article ${url}:`, error.message);
    return null;
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  console.log("--- Starting Professional Grade Scraper (Puppeteer) ---");

  let urlsToScrape: string[];

  try {
    // read the urls.txt
    const fileContent = await fs.readFile(URL_LIST_FILE, "utf-8");
    // every line is a new article
    urlsToScrape = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("http"));
  } catch (error) {
    console.error(
      `Could not read ${URL_LIST_FILE}. Please create it and add URLs.`
    );
    return;
  }

  if (urlsToScrape.length === 0) {
    console.error(`${URL_LIST_FILE} is empty.`);
    return;
  }

  // launch a headless browser
  const browser = await puppeteer.launch({ headless: true });

  // collect the article data
  const corpus: ArticleData[] = [];

  console.log(`\nFound ${urlsToScrape.length} URLs. Starting scraping...\n`);

  for (let i = 0; i < urlsToScrape.length; i++) {
    const url = urlsToScrape[i];
    console.log(`[${i + 1}/${urlsToScrape.length}] Scraping: ${url}`);

    const articleData = await scrapeArticle(browser, url);

    if (articleData && articleData.content.length > 150) {
      corpus.push(articleData);
    }
  }

  await browser.close();

  try {
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(corpus, null, 2));
    console.log(`\n--- Success! ---`);
    console.log(
      `Scraped ${corpus.length} articles and saved them to ${OUTPUT_FILE}`
    );
  } catch (error: any) {
    console.error(`\nError writing corpus to file:`, error.message);
  }
}

main();
