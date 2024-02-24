from db.db_manager import DatabaseManager

class DBService:
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager

    def insert_response(self, query, response):
        """
        Inserts a new record into the responses table with the provided query and response.
        """
        insert_query = """
        INSERT INTO responses (query, response)
        VALUES (%s, %s)
        """
        self.db_manager.query(insert_query, (query, response))
        self.db_manager.commit()  # Ensure db_manager has a commit method to save changes

    def fetch_response_by_query(self, query):
        """
        Fetches a response from the responses table matching the provided query.
        """
        select_query = """
        SELECT response FROM responses
        WHERE query = %s
        """
        results = self.db_manager.query(select_query, (query,))
        return results[0]['response'] if results else None

    def update_response(self, query, new_response):
        """
        Updates the response for a given query in the responses table.
        """
        update_query = """
        UPDATE responses
        SET response = %s
        WHERE query = %s
        """
        self.db_manager.query(update_query, (new_response, query))
        self.db_manager.commit()

    def delete_response(self, query):
        """
        Deletes a response from the responses table based on the given query.
        """
        delete_query = """
        DELETE FROM responses
        WHERE query = %s
        """
        self.db_manager.query(delete_query, (query,))
        self.db_manager.commit()
