import json
import os
import glob
import boto3
import requests
from langchain.agents import Tool
from langchain.chains import RetrievalQA
from langchain.text_splitter import CharacterTextSplitter
from langchain_community.chat_models import BedrockChat
from langchain.vectorstores import Chroma
from langchain_community.vectorstores import Chroma
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from litellm import completion
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def setup_knowledge_base(
    combined_product_catalog: str, model_name: str = "gpt-3.5-turbo"
):
    """
    We assume that the product catalog is simply a text string.
    """
    # Split the combined product catalog into smaller chunks
    text_splitter = CharacterTextSplitter(chunk_size=3000, chunk_overlap=500)
    texts = text_splitter.split_text(combined_product_catalog)

    llm = ChatOpenAI(model_name="gpt-4-0125-preview", temperature=0)

    embeddings = OpenAIEmbeddings()
    docsearch = Chroma.from_texts(
        texts, embeddings, collection_name="product-knowledge-base"
    )

    knowledge_base = RetrievalQA.from_chain_type(
        llm=llm, chain_type="stuff", retriever=docsearch.as_retriever()
    )
    return knowledge_base


def completion_bedrock(model_id, system_prompt, messages, max_tokens=1000):
    """
    High-level API call to generate a message with Anthropic Claude.
    """
    bedrock_runtime = boto3.client(
        service_name="bedrock-runtime", region_name=os.environ.get("AWS_REGION_NAME")
    )

    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": messages,
        }
    )

    response = bedrock_runtime.invoke_model(body=body, modelId=model_id)
    response_body = json.loads(response.get("body").read())

    return response_body


def get_product_id_from_query(query, product_price_id_mapping_path):
    # Load product_price_id_mapping from a JSON file
    with open(product_price_id_mapping_path, "r") as f:
        product_price_id_mapping = json.load(f)

    # Serialize the product_price_id_mapping to a JSON string for inclusion in the prompt
    product_price_id_mapping_json_str = json.dumps(product_price_id_mapping)

    # Dynamically create the enum list from product_price_id_mapping keys
    enum_list = list(product_price_id_mapping.values()) + [
        "No relevant product id found"
    ]
    enum_list_str = json.dumps(enum_list)

    prompt = f"""
    You are an expert data scientist and you are working on a project to recommend products to customers based on their needs.
    Given the following query:
    {query}
    and the following product price id mapping:
    {product_price_id_mapping_json_str}
    return the price id that is most relevant to the query.
    ONLY return the price id, no other text. If no relevant price id is found, return 'No relevant price id found'.
    Your output will follow this schema:
    {{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Price ID Response",
    "type": "object",
    "properties": {{
        "price_id": {{
        "type": "string",
        "enum": {enum_list_str}
        }}
    }},
    "required": ["price_id"]
    }}
    Return a valid directly parsable json, dont return in it within a code snippet or add any kind of explanation!!
    """
    prompt += "{"
    model_name = os.getenv("GPT_MODEL", "gpt-3.5-turbo-1106")

    if "anthropic" in model_name:
        response = completion_bedrock(
            model_id=model_name,
            system_prompt="You are a helpful assistant.",
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=1000,
        )

        product_id = response["content"][0]["text"]

    else:
        response = completion(
            model=model_name,
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=1000,
            temperature=0,
        )
        product_id = response.choices[0].message.content.strip()
    return product_id


def generate_stripe_payment_link(query: str) -> str:
    """Generate a stripe payment link for a customer based on a single query string."""

    # example testing payment gateway url
    PAYMENT_GATEWAY_URL = os.getenv(
        "PAYMENT_GATEWAY_URL", "https://agent-payments-gateway.vercel.app/payment"
    )
    PRODUCT_PRICE_MAPPING = os.getenv(
        "PRODUCT_PRICE_MAPPING", "example_product_price_id_mapping.json"
    )

    # use LLM to get the price_id from query
    price_id = get_product_id_from_query(query, PRODUCT_PRICE_MAPPING)
    price_id = json.loads(price_id)
    payload = json.dumps(
        {"prompt": query, **price_id, "stripe_key": os.getenv("STRIPE_API_KEY")}
    )
    headers = {
        "Content-Type": "application/json",
    }

    response = requests.request(
        "POST", PAYMENT_GATEWAY_URL, headers=headers, data=payload
    )
    return response.text

def get_mail_body_subject_from_query(query):
    prompt = f"""
    Given the query: "{query}", analyze the content and extract the necessary information to send an email. The information needed includes the recipient's email address, the subject of the email, and the body content of the email. 
    Based on the analysis, return a dictionary in Python format where the keys are 'recipient', 'subject', and 'body', and the values are the corresponding pieces of information extracted from the query. 
    For example, if the query was about sending an email to notify someone of an upcoming event, the output should look like this:
    {{
        "recipient": "example@example.com",
        "subject": "Upcoming Event Notification",
        "body": "Dear [Name], we would like to remind you of the upcoming event happening next week. We look forward to seeing you there."
    }}
    Now, based on the provided query, return the structured information as described.
    Return a valid directly parsable json, dont return in it within a code snippet or add any kind of explanation!!
    """
    model_name = os.getenv("GPT_MODEL", "gpt-3.5-turbo-1106")

    if "anthropic" in model_name:
        response = completion_bedrock(
            model_id=model_name,
            system_prompt="You are a helpful assistant.",
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=1000,
        )

        mail_body_subject = response["content"][0]["text"]

    else:
        response = completion(
            model=model_name,
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=1000,
            temperature=0.2,
        )
        mail_body_subject = response.choices[0].message.content.strip()
    print(mail_body_subject)
    return mail_body_subject

def send_email_with_gmail(email_details):
    '''.env should include GMAIL_MAIL and GMAIL_APP_PASSWORD to work correctly'''
    try:
        sender_email = os.getenv("GMAIL_MAIL")
        app_password = os.getenv("GMAIL_APP_PASSWORD")
        recipient_email = email_details["recipient"]
        subject = email_details["subject"]
        body = email_details["body"]
        # Create MIME message
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = recipient_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        # Create server object with SSL option
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(sender_email, app_password)
        text = msg.as_string()
        server.sendmail(sender_email, recipient_email, text)
        server.quit()
        return "Email sent successfully."
    except Exception as e:
        return f"Email was not sent successfully, error: {e}"

def send_email_tool(query):
    '''Sends an email based on the single query string'''
    email_details = get_mail_body_subject_from_query(query)
    if isinstance(email_details, str):
        email_details = json.loads(email_details)  # Ensure it's a dictionary
    print("EMAIL DETAILS")
    print(email_details)
    result = send_email_with_gmail(email_details)
    return result


def generate_calendly_invitation_link(query):
    '''Generate a calendly invitation link based on the single query string'''
    event_type_uuid = os.getenv("CALENDLY_EVENT_UUID")
    api_key = os.getenv('CALENDLY_API_KEY')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    url = 'https://api.calendly.com/scheduling_links'
    payload = {
    "max_event_count": 1,
    "owner": f"https://api.calendly.com/event_types/{event_type_uuid}",
    "owner_type": "EventType"
    }
    
    
    response = requests.post(url, json=payload, headers=headers)
    if response.status_code == 201:
        data = response.json()
        return f"url: {data['resource']['booking_url']}"
    else:
        return "Failed to create Calendly link: "


def extract_trip_info_from_query(query):
    """
    Use the LLM to extract trip information from the query.
    Returns a dictionary with keys:
    - departureDate
    - departureTime
    - origin
    - destination
    - passengers
    - vehicles
    - pets
    """
    prompt = f"""
    You are a helpful assistant that extracts trip information from user's queries.

    Extract the following information from the user's query:
    - departureDate (format YYYY-MM-DD)
    - departureTime (if specified, in HH:MM format)
    - origin (city or port name)
    - destination (city or port name)
    - number of passengers
    - number of vehicles
    - number of pets

    If any of the information is not specified, use default values:
    - departureDate: today's date in YYYY-MM-DD format
    - departureTime: empty string
    - origin: 'Rafina'
    - destination: 'Andros'
    - number of passengers: 1
    - number of vehicles: 0
    - number of pets: 0

    Return the result as a JSON object with the above keys.

    User's query: "{query}"

    Return a valid directly parsable JSON, don't return it within a code snippet or add any kind of explanation!!
    """

    model_name = os.getenv("GPT_MODEL", "gpt-3.5-turbo-1106")
    if "anthropic" in model_name:
        response = completion_bedrock(
            model_id=model_name,
            system_prompt="You are a helpful assistant.",
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=500,
        )
        trip_info_str = response["content"][0]["text"]
    else:
        response = completion(
            model=model_name,
            messages=[{"content": prompt, "role": "user"}],
            max_tokens=500,
            temperature=0.2,
        )
        trip_info_str = response.choices[0].message.content.strip()
    print(trip_info_str)
    # Now parse the JSON
    try:
        trip_info = json.loads(trip_info_str)
    except json.JSONDecodeError as e:
        print(f"Error parsing trip info: {e}")
        return None
    return trip_info

def get_port_code(port_name):
    # Simplify port_name
    port_name = port_name.strip().title()
    port_codes = {
        'Rafina': 'RAF',
        'Andros': 'AND',
        'Athens': 'ATH',
        'Santorini': 'SAN',
        # Add more mappings as required
    }
    return port_codes.get(port_name, 'RAF')  # default to 'RAF' if not found

def fetch_from_endpoint(query):
    print(f"Fetching trips with query: {query}")
    trip_info = extract_trip_info_from_query(query)
    if not trip_info:
        return "Could not extract trip information from query."
    # Map origin and destination to codes
    origin_code = get_port_code(trip_info.get('origin', 'Rafina'))
    destination_code = get_port_code(trip_info.get('destination', 'Andros'))
    # Construct the payload
    payload_data = [
        {
            "departureDate": trip_info.get('departureDate', '2024-11-31'),
            "departureTime": trip_info.get('departureTime', ''),
            "originIdOrCode": origin_code,
            "destinationIdOrCode": destination_code,
            "company": {
                "id": 0
            },
            "sorting": "BY_DEPARTURE_TIME",
            "availabilityInformation": True,
            "quoteRequest": {
                "passengers": int(trip_info.get('passengers', 1)),
                "vehicles": int(trip_info.get('vehicles', 0)),
                "pets": int(trip_info.get('pets', 0))
            }
        }
    ]
    payload = json.dumps(payload_data)

    url = "https://gds.liknoss.com/cws/resources/web-services/v200/b2b/list-of-trips"
    headers = {
        'agency-code': '1000',
        'Content-Type': 'application/json',
        'agency-user-name': 'TASOS',
        'agency-password': 'TLYK',
        'agency-signature': '31353135',
        'language-code': 'en'
    }

    response = requests.request("POST", url, headers=headers, data=payload)

    # Check for HTTP errors
    if response.status_code != 200:
        print(f"API request failed with status code {response.status_code}")
        return "Failed to fetch trips due to a network error."

    # Parse the response JSON
    try:
        response_data = response.json()
    except json.JSONDecodeError:
        print("Failed to parse response JSON.")
        return "Failed to parse response from the endpoint."

    # Check if 'tripsWithDictionary' is present
    trips_with_dict_list = response_data.get("tripsWithDictionary", [])
    if not trips_with_dict_list:
        print("No 'tripsWithDictionary' key in response data.")
        return "No trips found for the given query."

    trip_info_list = []

    for trips_with_dict in trips_with_dict_list:
        trips = trips_with_dict.get("trips", [])
        companies = trips_with_dict.get("companies", {})
        locations = trips_with_dict.get("locations", {})

        if not trips:
            continue  # Skip if no trips

        for trip in trips:
            # Extract basic trip details
            departure_datetime = trip.get("departureDateTime", "N/A")
            arrival_datetime = trip.get("arrivalDateTime", "N/A")
            origin_code = trip.get("origin", {}).get("idOrCode", "")
            destination_code = trip.get("destination", {}).get("idOrCode", "")

            # Get location names
            origin_name = locations.get(origin_code, {}).get("name", origin_code)
            destination_name = locations.get(destination_code, {}).get("name", destination_code)

            # Get vessel and company information
            vessel_code = trip.get("vessel", {}).get("idOrCode", "")
            company_abbr = trip.get("vessel", {}).get("company", {}).get("abbreviation", "")

            company_info = companies.get(company_abbr, {})
            company_name = company_info.get("name", company_abbr)

            vessel_name = company_info.get("vessels", {}).get(vessel_code, {}).get("name", vessel_code)

            # Extract basic price (convert from cents to euros)
            basic_price = trip.get("basicPrice", "N/A")
            if basic_price != "N/A":
                basic_price_eur = float(basic_price) / 100  # Convert cents to euros
                basic_price_eur = f"{basic_price_eur:.2f}€"
            else:
                basic_price_eur = "N/A"

            # Build trip info dictionary
            trip_info = {
                'Company': company_name,
                'Ferry': vessel_name,
                'Origin': origin_name,
                'Destination': destination_name,
                'DepartureTime': departure_datetime,
                'ArrivalTime': arrival_datetime,
                'Price': basic_price_eur  # Price in Euros as a string
            }

            trip_info_list.append(trip_info)

    if not trip_info_list:
        return json.dumps({"error": "No trips available for the selected criteria."})

    # Return the trip information as a JSON-formatted string
    return json.dumps({"trips": trip_info_list}, indent=2)


def get_tools(product_files):
    # Combine content from all product files
    # if not os.path.isdir(product_files):
    #     # raise ValueError(f"{product_files} is not a valid directory")
    #     return False
    #     # Combine content from all product files
    # combined_product_catalog = ""
    # print("Reading product files...")  # Debugging line
    # product_files = glob.glob(os.path.join(product_files, "*"))
    # for product_file in product_files:
    #     print(f"Reading file: {product_file}")  # Debugging line
    #     if not os.path.isfile(product_file):
    #         print(f"File not found: {product_file}")  # Debugging line
    #         continue  # Skip the missing file
    #     try:
    #         with open(product_file, "r") as f:
    #             combined_product_catalog += f.read() + "\n"
    #     except Exception as e:
    #         print(f"Error reading file {product_file}: {e}")  # Debugging line

    # Initialize knowledge base with the combined content
    # knowledge_base = setup_knowledge_base(combined_product_catalog)
    tools = [
        Tool(
            name="EndpointFetch",
            func=fetch_from_endpoint,
            description="Fetch ferry trip information based on user request. Input should include departure date, origin, destination, number of passengers, etc.",
        ),
        # Tool(
        #     name="ProductSearch",
        #     func=knowledge_base.run,
        #     description="useful for when you need to answer questions about product information or services offered, availability and their costs.",
        # ),
        Tool(
            name="GeneratePaymentLink",
            func=generate_stripe_payment_link,
            description="useful to close a transaction with a customer. You need to include product name and quantity and customer name in the query input.",
        ),
        Tool(
            name="SendEmail",
            func=send_email_tool,
            description="Sends an email based on the query input. The query should specify the recipient, subject, and body of the email.",
        ),
        Tool(
            name="SendCalendlyInvitation",
            func=generate_calendly_invitation_link,
            description='''Useful for when you need to create invite for a personal meeting in Sleep Heaven shop. 
            Sends a calendly invitation based on the query input.''',
        )
    ]

    return tools

