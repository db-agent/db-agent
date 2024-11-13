import pandas as pd
import os

class csv_module:
    def __init__(self) -> None:
        pass
    def get_csv_headers(folder):
        csv_headers = {}
        try:
            for file in os.listdir(folder):
                if file.endswith(".csv"):
                    file_path = os.path.join(folder, file)
                    df = pd.read_csv(file_path, nrows=0)  # Read only the header row
                    csv_headers[file] = df.columns.tolist()
        except:
            print("CSV error")
        
        return csv_headers