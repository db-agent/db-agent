import streamlit as st 
github_url = "https://github.com/becloudready/db-agent"

custom_css = f"""
    <style>
        /* Hide the Streamlit menu, header, and footer */
        #MainMenu {{ visibility: hidden; }}
        header {{ visibility: hidden; }}
        footer {{ visibility: hidden; }}

        /* Position the GitHub ribbon at the top-right corner */
        .github-ribbon {{
            position: fixed;
            top: 0;
            right: 0;
            z-index: 1000;
        }}

        /* Style for the logo at the bottom left corner */
        .logo {{
            position: fixed;
            bottom: 10px;
            left: 10px;
            z-index: 1000;
            width: 50px; /* Adjust as needed */
            height: auto;
        }}
    </style>

    <!-- Fork me on GitHub ribbon -->
    <a href="{github_url}" target="_blank" class="github-ribbon">
        <img decoding="async" width="149" height="149" 
             src="https://github.blog/wp-content/uploads/2008/12/forkme_right_green_007200.png" 
             alt="Fork me on GitHub" loading="lazy">
    </a>

    
"""
logo_file = "assets/logo.png"
st.logo(logo_file,size="large")
