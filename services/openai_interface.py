import openai

class OpenAIInterface:
    def __init__(self, api_key):
        openai.api_key = api_key

    def generate_text(self, prompt):
        response = openai.Completion.create(engine="text-davinci-003", prompt=prompt)
        return response.choices[0].text.strip()
