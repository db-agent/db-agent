from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
import torch
from transformers import pipeline

def sql_generator():
    # Set up the device to use CUDA if available
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load the CodeGen tokenizer and model
    model_name = "Salesforce/codegen-2B-mono"  # CodeGen model for code generation
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name)
    
    # Move the model to the appropriate device
    model.to(device)

    # Set up the pipeline for text-to-SQL generation
    pipe = pipeline("text-generation", model=model, tokenizer=tokenizer, device=device.index)

    # Input: natural language question
    natural_language_query = "List the first names and total amounts of all customers who have placed an order after January 1, 2023, and spent more than $500 in total."

    # Generate SQL using the model
    response = pipe(natural_language_query, max_length=200, num_return_sequences=1, pad_token_id=tokenizer.eos_token_id)

    # Print the generated SQL query
    generated_sql = response[0]['generated_text']
    print(f"Generated SQL Query:\n{generated_sql}")


def test_chat():
    messages = [
        {"role": "user", "content": "Who are you?"},
    ]
    pipe = pipeline("text-generation", model="meta-llama/Meta-Llama-3.1-405B-Instruct-FP8",
                    cache_dir="~/personal")
    pipe(messages)

if __name__ == "__main__":
    test_chat()
