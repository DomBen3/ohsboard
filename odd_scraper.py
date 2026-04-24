import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
import time
from datetime import datetime


def get_table_data(category, table):
    data = []
    rows = table.find_elements(By.TAG_NAME, "tr")
    for row in rows:
        cols = row.find_elements(By.TAG_NAME, "td")
        if cols:
            header = row.find_element(By.CLASS_NAME, "sportsbook-row-name").text
            over = cols[0].text.strip().replace("\n", " ")
            under = cols[1].text.strip().replace("\n", " ")
            data.append([category, header, over, under])
    return data


def getGameUrls():
    url = "https://sportsbook.draftkings.com/leagues/baseball/mlb"

    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")

    web_driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
    web_driver.get(url)

    items = web_driver.find_elements(By.CLASS_NAME, "event-cell-link")

    # Extract all mlb games
    urls = []
    for item in items:
        urls += [item.get_property("href")]
    urls = list(set(urls))

    return urls


def getGameData(url):
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")

    web_driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
    web_driver.get(url + "?category=odds&subcategory=pitcher-props")  # Show pitcher odds

    df1, df2 = None, None

    accordion_elements = web_driver.find_elements(By.CLASS_NAME, "sportsbook-event-accordion__accordion")
    for accordion in accordion_elements:
        if "Strikeouts Thrown" in accordion.text:
            # Find the table within the accordion element
            table_parent = accordion.find_element(By.XPATH, "..")
            table = table_parent.find_element(By.CLASS_NAME, "sportsbook-table__body")
            table_data = get_table_data("Strikeouts Thrown", table)
            if table_data:
                df1 = pd.DataFrame(table_data, columns=["Category", "Player", "Over", "Under"])
        if "Outs Recorded" in accordion.text:
            # Find the table within the accordion element
            table_parent = accordion.find_element(By.XPATH, "..")
            table = table_parent.find_element(By.CLASS_NAME, "sportsbook-table__body")
            table_data = get_table_data("Outs Recorded", table)
            if table_data:
                df2 = pd.DataFrame(table_data, columns=["Category", "Player", "Over", "Under"])

    web_driver.quit()

    if df1 is not None and df2 is not None:
        return pd.concat([df1, df2], ignore_index=True)
    elif df1 is not None:
        return df1
    elif df2 is not None:
        return df2
    else:
        return pd.DataFrame(columns=["Category", "Player", "Over", "Under"])


def driver():
    start = time.time()
    urls = getGameUrls()
    combined_df = pd.DataFrame(columns=["Category", "Player", "Over", "Under"])

    for i, url in enumerate(urls):
        game_df = getGameData(url)
        combined_df = pd.concat([combined_df, game_df], ignore_index=True)
        print("Finished game {} of {}".format((i + 1), len(urls)))

    # Create a filename with the current datetime
    current_time = datetime.now().strftime("%Y%m%d%H%M%S")
    filepath = f"data/MLB_Odds_{current_time}.csv"
    combined_df.to_csv(filepath)
    end = time.time()
    print(f"Time taken to finish: {end - start} seconds")


driver()
